import test from "node:test";
import assert from "node:assert/strict";
import {
  readGithubPages,
  collectGithubEvidence,
} from "./github-security-check.mjs";

const expectedRef = "refs/heads/development";
const expectedSha = "new";
function fixture() {
  return {
    analyses: ["javascript-typescript", "actions"].map((language) => ({
      commit_sha: expectedSha,
      ref: expectedRef,
      category: `/language:${language}`,
      tool: { name: "CodeQL" },
      error: "",
      rules_count: 10,
    })),
    repositoryAlerts: Array.from({ length: 16 }, (_, n) => ({
      number: n + 1,
      state: "open",
      rule: { id: `rule-${n}`, security_severity_level: "high" },
    })),
    refAlerts: [],
    dependabotAlerts: [
      {
        number: 1,
        state: "open",
        dependency: {
          package: { name: "esbuild", ecosystem: "npm" },
          manifest_path: "package.json",
        },
        security_advisory: { ghsa_id: "GHSA-g7r4-m6w7-qqqr", severity: "low" },
      },
    ],
  };
}
const lockfiles = [
  {
    name: "npm-shrinkwrap.json",
    lock: {
      lockfileVersion: 2,
      packages: { "node_modules/esbuild": { version: "0.28.2" } },
    },
  },
];
async function run(snapshot, extra = {}) {
  const calls = [];
  const report = await collectGithubEvidence({
    repository: "fixture/repo",
    expectedRef,
    expectedSha,
    sourceSha: expectedSha,
    lockfiles,
    now: "2026-11-04T00:00:00.000Z",
    fetchPages(url) {
      calls.push(url);
      if (url.includes("/analyses?")) return snapshot.analyses;
      if (url.includes("/dependabot/")) return snapshot.dependabotAlerts;
      if (url.includes("?ref=")) return snapshot.refAlerts;
      return snapshot.repositoryAlerts;
    },
    ...extra,
  });
  return { report, calls };
}

test("slurped pretty JSON pages flatten completely and malformed/error pages fail", () => {
  assert.deepEqual(
    readGithubPages(
      JSON.stringify([[{ number: 1 }], [{ number: 2 }]], null, 2),
    ),
    [{ number: 1 }, { number: 2 }],
  );
  for (const text of [
    "",
    "[]",
    "{}",
    '[[],{"message":"forbidden"}]',
    "[[null]]",
    "[[]]\n[[]]",
  ])
    assert.throws(() => readGithubPages(text));
});

test("exact successful scan can resolve development without dismissing main alerts", async () => {
  const { report, calls } = await run(fixture());
  assert.equal(report.passed, true);
  assert.equal(report.summary.total, 17);
  assert.equal(calls.length, 4);
  assert.ok(calls.some((url) => url.includes("/dependabot/alerts")));
  const dep = report.alerts.find((a) => a.number === "dependabot1");
  assert.equal(dep.state, "fixed_verified");
  assert.equal(dep.evidence.githubState, "open");
  assert.equal(dep.evidence.disposition, "resolved_on_ref_main_alert_open");
});

test("missing/stale analysis and missing historical alerts never become zero-alert success", async () => {
  for (const change of [
    { analyses: [] },
    { analyses: fixture().analyses.map((a) => ({ ...a, commit_sha: "old" })) },
    { analyses: fixture().analyses.slice(0, 1) },
    { repositoryAlerts: [] },
    { dependabotAlerts: [] },
  ])
    assert.equal((await run({ ...fixture(), ...change })).report.passed, false);
});

test("API errors, pagination failure and duplicate records block", async () => {
  const failed = await run(fixture(), {
    fetchPages() {
      throw new Error("permission or page failed");
    },
  });
  assert.equal(failed.report.blocked, true);
  assert.equal(failed.report.passed, false);
  const snapshot = fixture();
  snapshot.repositoryAlerts.push(snapshot.repositoryAlerts[0]);
  assert.equal((await run(snapshot)).report.passed, false);
});

test("target instance overrides repository state and stale instances block", async () => {
  const snapshot = fixture();
  snapshot.repositoryAlerts[0].state = "fixed";
  snapshot.refAlerts = [
    {
      ...snapshot.repositoryAlerts[0],
      most_recent_instance: {
        ref: expectedRef,
        commit_sha: expectedSha,
        state: "open",
        category: "/language:javascript-typescript",
      },
    },
  ];
  assert.equal((await run(snapshot)).report.passed, false);
  snapshot.refAlerts[0].most_recent_instance.state = "fixed";
  snapshot.refAlerts[0].most_recent_instance.commit_sha = "old";
  assert.equal((await run(snapshot)).report.passed, false);
});

test("failed analyses on an old SHA do not replace current successful evidence", async () => {
  const snapshot = fixture();
  snapshot.analyses.push({
    ...snapshot.analyses[0],
    commit_sha: "old",
    error: "failed",
    rules_count: 0,
  });
  assert.equal((await run(snapshot)).report.passed, true);
});

test("latest analysis on the same target determines success", async () => {
  const snapshot = fixture();
  snapshot.analyses[0].id = 2;
  snapshot.analyses.push({
    ...snapshot.analyses[0],
    id: 1,
    error: "old failed run",
    rules_count: 0,
  });
  assert.equal((await run(snapshot)).report.passed, true);
  snapshot.analyses.push({
    ...snapshot.analyses[0],
    id: 3,
    error: "latest failed run",
  });
  assert.equal((await run(snapshot)).report.passed, false);
});

test("new CodeQL or Dependabot alerts block even when historical alerts are resolved", async () => {
  for (const key of ["repositoryAlerts", "dependabotAlerts"]) {
    const snapshot = fixture();
    snapshot[key].push({ ...snapshot[key][0], number: 900 });
    assert.equal((await run(snapshot)).report.passed, false);
  }
});

test("dependency resolution is bound to checked-out SHA and every esbuild lock entry", async () => {
  assert.equal(
    (await run(fixture(), { sourceSha: "old" })).report.passed,
    false,
  );
  for (const version of ["0.27.4", "0.28.1-beta.1", "invalid"]) {
    const locks = structuredClone(lockfiles);
    locks[0].lock.packages["node_modules/other/node_modules/esbuild"] = {
      version,
    };
    assert.equal(
      (await run(fixture(), { lockfiles: locks })).report.passed,
      false,
    );
  }
  const snapshot = fixture();
  snapshot.analyses = snapshot.analyses.map((a) => ({
    ...a,
    ref: "refs/heads/main",
  }));
  assert.equal(
    (await run(snapshot, { expectedRef: "refs/heads/main" })).report.passed,
    false,
  );
});

const prRef = "refs/pull/6/merge";
// The 5 November 2026 gate situation: repository-wide list keeps the 16
// snapshot alerts open on main, the PR-ref scan carries its own alerts
// (PR-only numbers), and the analyses sit on the merge SHA/ref.
function prFixture(prAlerts) {
  const snapshot = fixture();
  snapshot.analyses = snapshot.analyses.map((a) => ({ ...a, ref: prRef }));
  snapshot.refAlerts = prAlerts.map((a) => ({
    number: a.number,
    state: a.state,
    rule: {
      id: a.rule ?? `rule-${a.number}`,
      security_severity_level: a.severity ?? "high",
    },
    most_recent_instance: {
      ref: prRef,
      commit_sha: expectedSha,
      state: a.state,
      category: "/language:javascript-typescript",
    },
  }));
  return snapshot;
}

test("PR merge-ref alerts are evaluated from the ref snapshot, not reported as repository drift", async () => {
  const snapshot = prFixture([
    { number: 17, state: "open", severity: "medium" },
    { number: 27, state: "fixed" },
    { number: 22, state: "open" },
  ]);
  const { report } = await run(snapshot, { expectedRef: prRef });
  assert.deepEqual(report.evidenceErrors, []);
  assert.equal(report.blocked, false);
  // Snapshot alerts stay open repository-wide but are absent from the
  // PR ref: judged fixed there once the analyses verify (16 code
  // scanning + dependabot1 resolved on the ref), plus PR-only alert 27
  // whose instance is fixed on the merge SHA.
  assert.equal(report.summary.fixed_verified, 18);
  const pr17 = report.alerts.find((a) => a.number === 17);
  assert.equal(pr17.evidence.observed, "pr_only_ref_instance");
  assert.equal(pr17.mapped, true);
  assert.ok(pr17.reasons.some((r) => r.startsWith("OPEN_ALERT")));
  assert.equal(
    report.alerts.find((a) => a.number === 27).state,
    "fixed_verified",
  );
  // An open PR alert without an approved exception still blocks.
  assert.equal(report.passed, false);
});

test("PR merge-ref alerts pass only through reviewed exceptions", async () => {
  const snapshot = prFixture([
    { number: 17, state: "open", severity: "medium" },
    { number: 22, state: "open" },
  ]);
  const exception = (number) => ({
    number,
    reason: "triaged residual risk",
    scope: "pr fixture",
    cwe: "CWE-79",
    compensation: "text/plain + nosniff envelope",
    owner: "ardani17",
    approvedBy: "reviewer@example.invalid",
    reviewedAt: "2026-11-03T00:00:00.000Z",
    expiresAt: "2026-11-30T00:00:00.000Z",
  });
  const { report } = await run(snapshot, {
    expectedRef: prRef,
    exceptions: [exception(17), exception(22)],
  });
  assert.equal(report.passed, true);
  assert.equal(report.summary.risk_accepted, 2);
});

test("branch refs keep the repository-list invariant (PR-only handling is PR-scoped)", async () => {
  const snapshot = fixture();
  snapshot.refAlerts = [
    {
      number: 17,
      state: "open",
      rule: { id: "rule-17", security_severity_level: "medium" },
      most_recent_instance: {
        ref: expectedRef,
        commit_sha: expectedSha,
        state: "open",
        category: "/language:javascript-typescript",
      },
    },
  ];
  const { report } = await run(snapshot);
  assert.ok(report.evidenceErrors.includes("REF_ALERT_NOT_IN_REPOSITORY: 17"));
  assert.equal(report.passed, false);
});
