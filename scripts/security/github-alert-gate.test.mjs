import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGithubAlerts } from "./github-alert-gate.mjs";

const FIXED_ALERT = (number, extra = {}) => ({
  number,
  state: "fixed",
  rule: { id: "rule-" + number, security_severity_level: "high" },
  ...extra,
});

const OPEN_ALERT = (number, severity = "critical") => ({
  number,
  state: "open",
  rule: { id: "rule-" + number, security_severity_level: severity },
});

const FRESH = (sha, ref = "refs/heads/development") => ({
  commit_sha: sha,
  ref,
});

test("successful analysis job with open alert is not a clean gate", () => {
  const r = evaluateGithubAlerts({
    alerts: [OPEN_ALERT(9)],
    analyses: [{ commit_sha: "old" }],
    expectedRef: "refs/heads/development",
    expectedSha: "new",
    exceptions: [],
  });
  assert.equal(r.passed, false);
});

test("api failures are blocked, never a zero-alert pass", () => {
  const r = evaluateGithubAlerts({
    alerts: [],
    analyses: [],
    expectedRef: "refs/heads/development",
    expectedSha: "new",
    exceptions: [],
    apiOk: false,
  });
  assert.equal(r.blocked, true);
  assert.equal(r.passed, false);
  assert.ok(r.gateReasons.some((x) => x.startsWith("API_ERROR")));
});

test("stale or missing analysis on the exact sha blocks", () => {
  for (const analyses of [[], [{ commit_sha: "other" }]]) {
    const r = evaluateGithubAlerts({
      alerts: [FIXED_ALERT(1)],
      analyses,
      expectedRef: "refs/heads/development",
      expectedSha: "sha-new",
      exceptions: [],
    });
    assert.equal(r.passed, false, JSON.stringify(analyses));
    assert.ok(
      r.gateReasons.some(
        (x) => x.startsWith("MISSING_ANALYSIS") || x.startsWith("STALE_SHA"),
      ),
    );
  }
});

test("mapped fixed alerts on the fresh sha pass the gate", () => {
  const r = evaluateGithubAlerts({
    alerts: [
      FIXED_ALERT(1),
      FIXED_ALERT(16),
      FIXED_ALERT("dependabot1", { tool: "dependabot" }),
    ],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [],
  });
  assert.equal(r.passed, true);
  assert.equal(r.summary.fixed_verified, 3);
});

test("unmapped or category-less open alerts block", () => {
  const unmapped = evaluateGithubAlerts({
    alerts: [OPEN_ALERT(99)],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [],
  });
  assert.equal(unmapped.passed, false);
  assert.ok(
    unmapped.alerts.some((a) =>
      a.reasons.some((x) => x.startsWith("UNMAPPED_ALERT")),
    ),
  );

  const noCategory = evaluateGithubAlerts({
    alerts: [{ number: 5, state: "open", rule: {} }],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [],
  });
  assert.equal(noCategory.passed, false);
  assert.ok(
    noCategory.alerts.some((a) =>
      a.reasons.some((x) => x.startsWith("CATEGORY_MISSING")),
    ),
  );
});

test("expired or incomplete exceptions do not count as accepted", () => {
  const expired = evaluateGithubAlerts({
    alerts: [OPEN_ALERT(11)],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [
      {
        number: 11,
        reason: "legacy",
        scope: "cwmp",
        owner: "admin",
        expiresAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    now: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(expired.passed, false);
  assert.ok(
    expired.alerts.some((a) => a.reasons.includes("EXPIRED_EXCEPTION")),
  );

  const incomplete = evaluateGithubAlerts({
    alerts: [OPEN_ALERT(12)],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [{ number: 12, expiresAt: "2026-12-01T00:00:00.000Z" }],
    now: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(incomplete.passed, false);
});

test("residual protocol crypto risks are risk_accepted, not fixed", () => {
  const r = evaluateGithubAlerts({
    alerts: [OPEN_ALERT(11), OPEN_ALERT(12), OPEN_ALERT(13)],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [
      {
        number: 11,
        reason: "MD5 wire compat",
        scope: "cwmp digest",
        cwe: "CWE-327",
        compensation: "TLS + mgmt network",
        owner: "admin",
        expiresAt: "2026-11-30T00:00:00.000Z",
      },
      {
        number: 12,
        reason: "Annex G HMAC-SHA1",
        scope: "udp cr",
        cwe: "CWE-327",
        compensation: "mgmt network",
        owner: "admin",
        expiresAt: "2026-11-30T00:00:00.000Z",
      },
      {
        number: 13,
        reason: "SCRAM-SHA-1 legacy path gated",
        scope: "xmpp",
        cwe: "CWE-327",
        compensation: "TLS mandatory, flag off",
        owner: "admin",
        expiresAt: "2026-11-30T00:00:00.000Z",
      },
    ],
    now: "2026-11-01T00:00:00.000Z",
  });
  assert.equal(r.passed, true);
  assert.equal(r.summary.risk_accepted, 3);
});

test("a new critical alert after the snapshot blocks the gate", () => {
  const r = evaluateGithubAlerts({
    alerts: [FIXED_ALERT(1), OPEN_ALERT(777, "critical")],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [],
  });
  assert.equal(r.passed, false);
  assert.ok(
    r.alerts.some(
      (a) =>
        a.number === 777 &&
        a.reasons.includes("REQUIRED_NOT_RESOLVED") === false &&
        a.reasons.some((x) => x.startsWith("UNMAPPED_ALERT")),
    ),
  );
});

test("incomplete pagination is reflected by the caller-provided apiOk=false path", () => {
  // The workflow treats any pagination/permission problem as apiOk=false;
  // the evaluator must keep the gate blocked rather than empty.
  const r = evaluateGithubAlerts({
    alerts: [FIXED_ALERT(1)],
    analyses: [FRESH("sha-new")],
    expectedRef: "refs/heads/development",
    expectedSha: "sha-new",
    exceptions: [],
    apiOk: false,
  });
  assert.equal(r.passed, false);
  assert.equal(r.blocked, true);
});
