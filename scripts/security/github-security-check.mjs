// Read-only GitHub evidence collection. Tests inject transport; no token is
// persisted, logged, or included in the report.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ALERT_MAPPING,
  ANALYSIS_CATEGORIES,
  evaluateGithubAlerts,
} from "./github-alert-gate.mjs";

export function readGithubPages(text) {
  const pages = JSON.parse(text);
  if (
    !Array.isArray(pages) ||
    !pages.length ||
    pages.some((p) => !Array.isArray(p))
  )
    throw new Error("INVALID_API_PAGES");
  const rows = pages.flat();
  if (rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
    throw new Error("INVALID_API_RECORD");
  return rows;
}

function patchedEsbuild(lockfiles) {
  if (
    !Array.isArray(lockfiles) ||
    !lockfiles.some((f) => f.name === "npm-shrinkwrap.json")
  )
    return false;
  const versions = [];
  for (const { lock } of lockfiles) {
    if (
      ![2, 3].includes(lock?.lockfileVersion) ||
      !lock.packages ||
      typeof lock.packages !== "object"
    )
      return false;
    for (const [entry, pkg] of Object.entries(lock.packages)) {
      if (
        entry === "node_modules/esbuild" ||
        entry.endsWith("/node_modules/esbuild")
      )
        versions.push(pkg.version);
    }
  }
  const root = lockfiles.find((f) => f.name === "npm-shrinkwrap.json").lock;
  if (!root.packages["node_modules/esbuild"]) return false;
  return (
    versions.length > 0 &&
    versions.every((v) => {
      if (typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v)) return false;
      const parts = v.split(".").map(Number);
      return (
        parts.every(Number.isSafeInteger) &&
        (parts[0] > 0 || parts[1] > 28 || (parts[1] === 28 && parts[2] >= 1))
      );
    })
  );
}

export async function collectGithubEvidence({
  repository,
  expectedRef,
  expectedSha,
  sourceSha,
  fetchPages,
  lockfiles = [],
  exceptions = [],
  now = new Date().toISOString(),
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("INVALID_REPOSITORY");
  const base = `/repos/${repository}`;
  const ref = encodeURIComponent(expectedRef);
  const endpoints = {
    analyses: `${base}/code-scanning/analyses?ref=${ref}&per_page=100`,
    repositoryAlerts: `${base}/code-scanning/alerts?per_page=100`,
    refAlerts: `${base}/code-scanning/alerts?ref=${ref}&per_page=100`,
    dependabotAlerts: `${base}/dependabot/alerts?per_page=100`,
  };
  const results = await Promise.allSettled(
    Object.values(endpoints).map(async (url) => fetchPages(url)),
  );
  const snapshot = {};
  const errors = [];
  Object.keys(endpoints).forEach((key, i) => {
    const result = results[i];
    if (
      result.status !== "fulfilled" ||
      !Array.isArray(result.value) ||
      result.value.some(
        (row) => !row || typeof row !== "object" || Array.isArray(row),
      )
    ) {
      errors.push("API_OR_SCHEMA_ERROR: " + key);
      snapshot[key] = [];
    } else snapshot[key] = result.value;
  });
  const { analyses, repositoryAlerts, refAlerts, dependabotAlerts } = snapshot;
  for (const category of ANALYSIS_CATEGORIES) {
    const latest = analyses
      .filter(
        (a) =>
          a.commit_sha === expectedSha &&
          a.ref === expectedRef &&
          a.category === category &&
          a.tool?.name === "CodeQL",
      )
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
    if (
      latest &&
      (!Number.isInteger(latest.rules_count) || latest.rules_count <= 0)
    )
      errors.push("INVALID_ANALYSIS_COVERAGE: " + category);
  }

  const index = (rows, label) => {
    const map = new Map();
    for (const row of rows) {
      if (
        !Number.isInteger(row.number) ||
        row.number <= 0 ||
        map.has(row.number)
      )
        errors.push("INVALID_OR_DUPLICATE_ALERT: " + label);
      map.set(row.number, row);
    }
    return map;
  };
  const repositoryIndex = index(repositoryAlerts, "repository");
  const refIndex = index(refAlerts, "ref");
  index(dependabotAlerts, "dependabot");
  for (const [number, mapping] of Object.entries(ALERT_MAPPING)) {
    if (!/^\d+$/.test(number) || mapping?.pr) continue;
    if (!repositoryIndex.has(Number(number)))
      errors.push("MISSING_SNAPSHOT_ALERT: " + number);
  }
  if (!dependabotAlerts.some((a) => a.number === 1))
    errors.push("MISSING_SNAPSHOT_ALERT: dependabot1");
  // GitHub keeps pull-request analyses out of the repository-wide alert
  // list: on a PR merge ref, ref alerts missing from that list are
  // expected PR-only alerts and must be EVALUATED, not reported as API
  // drift. On branch refs the invariant stays strict.
  const prMergeRef = /^refs\/pull\/\d+\/merge$/.test(expectedRef);
  const prOnlyAlerts = [];
  for (const [number, alert] of refIndex) {
    if (repositoryIndex.has(number)) continue;
    if (!prMergeRef) {
      errors.push("REF_ALERT_NOT_IN_REPOSITORY: " + number);
      continue;
    }
    const instance = alert.most_recent_instance;
    if (
      !instance ||
      !["open", "fixed", "dismissed"].includes(instance.state) ||
      !ANALYSIS_CATEGORIES.includes(instance.category)
    )
      errors.push("INVALID_REF_INSTANCE: " + number);
    prOnlyAlerts.push({
      number: alert.number,
      rule: alert.rule,
      tool: "code-scanning",
      state: instance?.state,
      ...(instance ? { most_recent_instance: instance } : {}),
      evidence: {
        ref: expectedRef,
        sha: expectedSha,
        observed: "pr_only_ref_instance",
      },
    });
  }

  // The ref endpoint returns the instance on this ref, whereas repository-wide
  // state can remain open on main. Absence is only useful with the evaluator's
  // complete, successful analyses of this exact SHA/ref and both categories.
  const alerts = [
    ...repositoryAlerts.map((alert) => {
      const scoped = refIndex.get(alert.number);
      const instance = scoped?.most_recent_instance;
      if (
        scoped &&
        (!instance ||
          !["open", "fixed", "dismissed"].includes(instance.state) ||
          !ANALYSIS_CATEGORIES.includes(instance.category))
      )
        errors.push("INVALID_REF_INSTANCE: " + alert.number);
      return {
        number: alert.number,
        rule: alert.rule,
        tool: "code-scanning",
        state: scoped ? instance?.state : "fixed",
        ...(instance ? { most_recent_instance: instance } : {}),
        evidence: {
          ref: expectedRef,
          sha: expectedSha,
          observed: scoped ? "ref_instance" : "absent_from_ref",
        },
      };
    }),
    ...prOnlyAlerts,
  ];
  const graphPatched = sourceSha === expectedSha && patchedEsbuild(lockfiles);
  for (const alert of dependabotAlerts) {
    const number = `dependabot${alert.number}`;
    const known =
      number === "dependabot1" &&
      alert.security_advisory?.ghsa_id === ALERT_MAPPING.dependabot1.advisory &&
      alert.dependency?.package?.name === "esbuild" &&
      alert.dependency?.package?.ecosystem === "npm" &&
      alert.dependency?.manifest_path === "package.json";
    if (number === "dependabot1" && !known)
      errors.push("DEPENDABOT_IDENTITY_CHANGED");
    if (known && !graphPatched) errors.push("DEPENDENCY_GRAPH_NOT_VERIFIED");
    const resolvedOnRef =
      known &&
      graphPatched &&
      alert.state === "open" &&
      expectedRef !== "refs/heads/main";
    alerts.push({
      number,
      tool: "dependabot",
      state: resolvedOnRef ? "fixed" : alert.state,
      rule: {
        id: alert.security_advisory?.ghsa_id,
        security_severity_level: alert.security_advisory?.severity,
      },
      evidence: {
        ref: expectedRef,
        sha: sourceSha,
        githubState: alert.state,
        disposition: resolvedOnRef
          ? "resolved_on_ref_main_alert_open"
          : "github_state",
      },
    });
  }
  const neededExceptions = exceptions.filter((ex) =>
    alerts.some((a) => a.number === ex.number && a.state !== "fixed"),
  );
  const report = evaluateGithubAlerts({
    alerts,
    analyses,
    expectedRef,
    expectedSha,
    exceptions: neededExceptions,
    apiOk: errors.length === 0,
    now,
  });
  return {
    ...report,
    repository,
    evidenceErrors: errors,
    analysisCount: analyses.length,
    sourceSha,
    analysisEvidence: analyses
      .filter((a) => a.commit_sha === expectedSha && a.ref === expectedRef)
      .map(
        ({
          id,
          commit_sha,
          ref: analysisRef,
          category,
          error,
          rules_count,
        }) => ({
          id,
          commit_sha,
          ref: analysisRef,
          category,
          error,
          rules_count,
        }),
      ),
  };
}

export async function runGithubSecurityCheck() {
  const expectedSha = process.env.EXPECTED_SHA;
  const expectedRef = process.env.EXPECTED_REF;
  if (
    !/^[a-f0-9]{40}$/.test(expectedSha ?? "") ||
    !/^refs\/(heads\/[^\s]+|pull\/\d+\/merge)$/.test(expectedRef ?? "")
  )
    throw new Error("INVALID_EXPECTED_TARGET");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 5000,
  }).trim();
  if (sourceSha !== expectedSha) throw new Error("CHECKOUT_SHA_MISMATCH");
  const policy = JSON.parse(
    readFileSync("docs/testing/github-security-evidence.json", "utf8"),
  );
  const exceptions = Object.entries(policy.alerts)
    .filter(([, entry]) => entry.exception)
    .map(([number, entry]) => ({
      number: /^\d+$/.test(number) ? Number(number) : number,
      ...entry.exception,
    }));
  const lockfiles = ["npm-shrinkwrap.json", "apps/web/package-lock.json"].map(
    (name) => ({
      name,
      lock: JSON.parse(readFileSync(name, "utf8")),
    }),
  );
  const report = await collectGithubEvidence({
    repository: process.env.GITHUB_REPOSITORY,
    expectedRef,
    expectedSha,
    sourceSha,
    lockfiles,
    exceptions,
    fetchPages(url) {
      // --slurp encloses complete JSON pages in one array, including pretty JSON.
      // Never print stderr: it is transport data, not trusted report content.
      return readGithubPages(
        execFileSync("gh", ["api", "--paginate", "--slurp", url], {
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    },
  });
  const output = path.resolve("artifacts/security/github-alert-report.json");
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.passed ? 0 : 1;
}
