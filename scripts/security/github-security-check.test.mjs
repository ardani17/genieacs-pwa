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
