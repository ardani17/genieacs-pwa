import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGithubAlerts } from "./github-alert-gate.mjs";

const target = {
  expectedSha: "sha-new",
  expectedRef: "refs/heads/development",
  now: "2026-11-04T00:00:00.000Z",
};
const analyses = ["javascript-typescript", "actions"].map((language) => ({
  commit_sha: target.expectedSha,
  ref: target.expectedRef,
  category: `/language:${language}`,
  tool: { name: "CodeQL" },
  error: "",
}));
const alert = (number = 11, state = "open") => ({
  number,
  state,
  rule: {
    id: "js/weak-cryptographic-algorithm",
    security_severity_level: "high",
  },
});
const exception = (extra = {}) => ({
  number: 11,
  reason: "TR-069 wire compatibility",
  scope: "CWMP Digest only",
  cwe: "CWE-327",
  compensation: "TLS and restricted management network",
  owner: "operator",
  approvedBy: "reviewer@example.invalid",
  reviewedAt: "2026-11-03T00:00:00.000Z",
  expiresAt: "2026-11-30T00:00:00.000Z",
  ...extra,
});
const evaluate = (extra) =>
  evaluateGithubAlerts({ ...target, analyses, ...extra });

test("SHA and ref must match on the same analysis", () => {
  const r = evaluate({
    alerts: [],
    analyses: [
      ...analyses.map((a) => ({ ...a, ref: "refs/heads/main" })),
      ...analyses.map((a) => ({ ...a, commit_sha: "old" })),
    ],
  });
  assert.equal(r.passed, false);
});

test("missing Actions category or failed CodeQL analysis cannot pass", () => {
  for (const rows of [
    analyses.slice(0, 1),
    analyses.map((a) => ({ ...a, error: "failed" })),
  ]) {
    assert.equal(evaluate({ alerts: [], analyses: rows }).passed, false);
  }
});

test("a GitHub dismissal alone is not an approved exception", () => {
  assert.equal(evaluate({ alerts: [alert(11, "dismissed")] }).passed, false);
});

test("unmapped alerts cannot bypass mapping through an exception", () => {
  const r = evaluate({
    alerts: [alert(999)],
    exceptions: [exception({ number: 999 })],
  });
  assert.equal(r.passed, false);
});

test("exception dates and human approval must be valid and bounded", () => {
  for (const extra of [
    { expiresAt: "not-a-date" },
    { expiresAt: "2026-11-31T00:00:00.000Z" },
    { expiresAt: "2027-01-01T00:00:00.000Z" },
    { approvedBy: "" },
    { approvedBy: "human-reviewer" },
    { reviewedAt: "2026-11-05T00:00:00.000Z" },
    { cwe: "" },
    { compensation: "" },
  ]) {
    assert.equal(
      evaluate({ alerts: [alert()], exceptions: [exception(extra)] }).passed,
      false,
      JSON.stringify(extra),
    );
  }
});

test("stale analysis or an API failure never labels an alert fixed verified", () => {
  for (const extra of [{ analyses: [] }, { apiOk: false }]) {
    const r = evaluate({ alerts: [alert(1, "fixed")], ...extra });
    assert.equal(r.passed, false);
    assert.equal(r.alerts[0].state, "needs_validation");
  }
});

test("complete reviewed protocol exception remains risk accepted", () => {
  const r = evaluate({ alerts: [alert()], exceptions: [exception()] });
  assert.equal(r.passed, true);
  assert.equal(r.alerts[0].state, "risk_accepted");
});
