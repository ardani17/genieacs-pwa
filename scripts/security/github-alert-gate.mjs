// GitHub security-alert release gate (offline evaluator).
//
// evaluateGithubAlerts decides, from alert + analysis snapshots and the
// reviewed exception list, whether the ref is releasable. A successful
// analysis job is NEVER treated as a clean gate: alerts must be
// fixed-verified on the exact expected SHA/ref, or covered by an
// unexpired human-reviewed exception (risk_accepted), or they block.
// API failures (401/403), missing analyses and stale SHAs are "blocked",
// never "zero alerts".

// Curated mapping of every alert in the 1 November 2026 snapshot to the
// package/ticket/test evidence that addresses it, plus the pull-request
// merge-ref alerts triaged under ARD-206 (marked pr:true — they never
// exist in the repository-wide list and are absent once their PR
// closes). Residual protocol-crypto findings are risk_accepted via
// exceptions, never silently "fixed".
export const ALERT_MAPPING = {
  1: {
    package: "M01-S3",
    ticket: "ARD-200",
    tests: ["test/security/escaping.ts"],
    required: true,
  },
  2: {
    package: "M01-S3",
    ticket: "ARD-200",
    tests: ["test/security/escaping.ts"],
    required: true,
  },
  3: {
    package: "M01-S4",
    ticket: "ARD-201",
    tests: ["test/security/like-pattern.ts"],
    required: true,
  },
  4: {
    package: "M01-S3",
    ticket: "ARD-200",
    tests: ["test/security/error-response.ts"],
    required: true,
  },
  5: {
    package: "M01-S3",
    ticket: "ARD-200",
    tests: ["test/security/error-response.ts"],
    required: true,
  },
  6: {
    package: "M01-S3",
    ticket: "ARD-200",
    tests: ["test/security/error-response.ts"],
    required: true,
  },
  7: {
    package: "M01-S2",
    ticket: "ARD-199",
    tests: ["test/security/nbi-query.ts", "test/security/nbi-route.ts"],
    required: true,
  },
  8: {
    package: "M01-S2",
    ticket: "ARD-199",
    tests: ["test/security/nbi-query.ts", "test/security/nbi-route.ts"],
    required: true,
  },
  9: {
    package: "M01-S1",
    ticket: "ARD-198",
    tests: ["test/security/script-validation.ts"],
    required: true,
  },
  10: {
    package: "M01-S1",
    ticket: "ARD-198",
    tests: ["test/security/script-validation.ts"],
    required: true,
  },
  11: {
    package: "M01-S6",
    ticket: "ARD-203",
    tests: ["test/security/http-digest.ts"],
    required: true,
    residualProtocol: true,
  },
  12: {
    package: "M01-S7",
    ticket: "ARD-204",
    tests: ["test/security/udp-cr-auth.ts"],
    required: true,
    residualProtocol: true,
  },
  13: {
    package: "M01-S8",
    ticket: "ARD-205",
    tests: ["test/security/xmpp-scram.ts"],
    required: true,
    residualProtocol: true,
  },
  14: {
    package: "M01-S8",
    ticket: "ARD-205",
    tests: ["test/security/xmpp-scram.ts"],
    required: true,
    residualProtocol: true,
  },
  15: {
    package: "M01-S4",
    ticket: "ARD-201",
    tests: ["test/security/expression-parser.ts"],
    required: true,
  },
  16: {
    package: "M01-S5",
    ticket: "ARD-202",
    tests: ["test/security/cwmp-cookie.ts"],
    required: true,
  },
  // Pull-request merge-ref alerts (triaged 6 November 2026 from the
  // refs/pull/6/merge analysis at 351a638; see
  // docs/testing/github-security-evidence.json). GitHub keeps PR-ref
  // analyses OUT of the repository-wide alert list, so the collector
  // evaluates these from the PR-ref snapshot; pr:true also excludes
  // them from the snapshot completeness check — they exist only while
  // that pull request is open, and later PRs re-triage new numbers.
  17: {
    package: "M01-S5",
    ticket: "ARD-206",
    tests: ["test/security/cwmp-cookie.ts"],
    required: true,
    pr: true,
    fixedInPr: "status echo removed from the cookie-error body",
  },
  18: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  19: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    fixedInPr: "init validation errors routed through sendSafeLegacyError",
  },
  20: {
    package: "M01-S2",
    ticket: "ARD-206",
    tests: ["test/security/nbi-query.ts", "test/security/nbi-route.ts"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  21: {
    package: "M01-S2",
    ticket: "ARD-206",
    tests: ["test/security/nbi-query.ts", "test/security/nbi-route.ts"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  22: {
    package: "M01-S7",
    ticket: "ARD-206",
    tests: ["test/security/udp-cr-auth.ts"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  23: {
    package: "M01-E",
    ticket: "ARD-206",
    tests: ["test/app-logger.ts"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  24: {
    package: "M01-E",
    ticket: "ARD-206",
    tests: ["test/app-logger.ts"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  25: {
    package: "M01-E",
    ticket: "ARD-206",
    tests: ["test/app-logger.ts"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  26: {
    package: "M01-A",
    ticket: "ARD-206",
    tests: ["scripts/security/inventory.test.mjs"],
    required: true,
    pr: true,
    residualProtocol: true,
  },
  27: {
    package: "M01-S2",
    ticket: "ARD-206",
    tests: ["test/security/nbi-query.ts"],
    required: true,
    pr: true,
    fixedInPr: "projection/sort built via Map, not computed keys",
  },
  28: {
    package: "M01-S2",
    ticket: "ARD-206",
    tests: ["test/security/nbi-query.ts"],
    required: true,
    pr: true,
    fixedInPr: "projection/sort built via Map, not computed keys",
  },
  29: {
    package: "M01-E",
    ticket: "ARD-206",
    tests: ["test/engine-app-logger-broken-dir.ts"],
    required: true,
    pr: true,
    fixedInPr: "unique mkdtemp base directory",
  },
  // PR #8 (M05-M06 integration) alerts, triaged 7 November 2026 from
  // the refs/pull/8/merge analysis at b8bf7d1. Line shifts from the
  // M05/M06 changes renumbered the app-logger sinks (23/24 -> 79/80);
  // the reflected-xss rule additionally fires at the same envelope
  // call sites the reviewer approved as a class on 7 November 2026
  // (alert 18). management-wan polynomial redos are code-fixed.
  68: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "json",
  },
  69: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "json",
  },
  70: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "json",
  },
  71: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "legacy",
  },
  72: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "json",
  },
  73: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "json",
  },
  74: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "legacy",
  },
  75: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "json",
  },
  76: {
    package: "M01-S3",
    ticket: "ARD-206",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "legacy",
  },
  77: {
    package: "M05-A",
    ticket: "ARD-206",
    tests: ["packages/device-profiles/src/management-wan.test.ts"],
    required: true,
    pr: true,
    fixedInPr:
      "linear trimTrailingDots replaces the polynomial /\\.+$/ regexes",
  },
  78: {
    package: "M05-A",
    ticket: "ARD-206",
    tests: ["packages/device-profiles/src/management-wan.test.ts"],
    required: true,
    pr: true,
    fixedInPr:
      "linear trimTrailingDots replaces the polynomial /\\.+$/ regexes",
  },
  79: {
    package: "M01-E",
    ticket: "ARD-206",
    tests: ["test/app-logger.ts"],
    required: true,
    pr: true,
    renumberedFrom: 23,
  },
  80: {
    package: "M01-E",
    ticket: "ARD-206",
    tests: ["test/app-logger.ts"],
    required: true,
    pr: true,
    renumberedFrom: 24,
  },
  81: {
    package: "M05-C",
    ticket: "ARD-221",
    tests: ["test/wan-operations.ts"],
    required: true,
    pr: true,
    fixedInPr:
      "unconditional post-refresh authorization before client-selected binding decisions",
  },
  // PR #9 M07 source review. New alert numbers retain the same exact-ref
  // verification and named-human exception requirements as earlier PRs.
  82: {
    package: "M07-A",
    tests: ["test/security/error-response.ts"],
    required: true,
    pr: true,
    envelope: "json",
  },
  83: {
    package: "M07-A",
    tests: ["docker/bootstrap-secrets.test.mjs"],
    required: true,
    pr: true,
  },
  84: {
    package: "M07-A",
    tests: ["docker/bootstrap-secrets.test.mjs"],
    required: true,
    pr: true,
  },
  85: {
    package: "M07-B",
    tests: ["services/vpn-controller/test/recovery.test.ts"],
    required: true,
    pr: true,
  },
  86: {
    package: "M07-B",
    tests: ["test/internal-url.ts"],
    required: true,
    pr: true,
  },
  87: {
    package: "M07-B",
    tests: ["scripts/fixtures/vpn-evidence.test.mjs"],
    required: true,
    pr: true,
  },
  88: {
    package: "M07-B",
    tests: ["test/internal-url.ts"],
    required: true,
    pr: true,
  },
  89: {
    package: "M07-B",
    tests: ["test/internal-url.ts"],
    required: true,
    pr: true,
  },
  90: {
    package: "M07-B",
    tests: ["test/settings-permissions.ts"],
    required: true,
    pr: true,
  },
  91: {
    package: "M07-C",
    tests: ["scripts/fixtures/m07-outage.mjs"],
    required: true,
    pr: true,
  },
  92: {
    package: "M07-B",
    tests: ["scripts/fixtures/vpn-evidence.test.mjs"],
    required: true,
    pr: true,
  },
  93: {
    package: "M07-B",
    tests: ["scripts/fixtures/vpn-evidence.test.mjs"],
    required: true,
    pr: true,
  },
  94: {
    package: "M07-A",
    tests: ["test/app-settings.ts"],
    required: true,
    pr: true,
  },
  95: {
    package: "M07-A",
    tests: ["test/app-settings.ts"],
    required: true,
    pr: true,
  },
  96: {
    package: "M07-B",
    tests: ["scripts/fixtures/vpn-evidence.test.mjs"],
    required: true,
    pr: true,
    renumberedFrom: 87,
  },
  97: {
    package: "M07-B",
    tests: ["test/internal-url.ts"],
    required: true,
    pr: true,
    renumberedFrom: 88,
  },
  dependabot1: {
    package: "M01-B",
    ticket: "ARD-165",
    tests: ["test/db.ts", "test/security-compat.ts"],
    advisory: "GHSA-g7r4-m6w7-qqqr",
    minFixed: "0.28.1",
    target: "0.28.2",
    required: true,
  },
};

export const ANALYSIS_CATEGORIES = Object.freeze([
  "/language:javascript-typescript",
  "/language:actions",
]);

function exceptionProblems(ex, now) {
  const fields = [
    "reason",
    "scope",
    "cwe",
    "compensation",
    "owner",
    "approvedBy",
    "reviewedAt",
    "expiresAt",
  ];
  const problems = [];
  const missing = fields.filter(
    (f) => typeof ex[f] !== "string" || !ex[f].trim(),
  );
  if (missing.length)
    problems.push("INCOMPLETE_EXCEPTION: missing " + missing.join("/"));
  if (
    /^(human-reviewer|pending|tbd|todo|unknown|agent|codex|bot)$/i.test(
      ex.approvedBy ?? "",
    ) ||
    /\[bot\]$/i.test(ex.approvedBy ?? "")
  )
    problems.push("UNREVIEWED_EXCEPTION");
  const reviewed = Date.parse(ex.reviewedAt);
  const expiry = Date.parse(ex.expiresAt);
  const current = Date.parse(now);
  const canonical = (value, parsed) =>
    Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  if (
    !canonical(ex.reviewedAt, reviewed) ||
    !canonical(ex.expiresAt, expiry) ||
    !canonical(now, current)
  )
    problems.push("INVALID_EXCEPTION_DATE");
  else {
    if (expiry <= current) problems.push("EXPIRED_EXCEPTION");
    if (
      reviewed > current ||
      expiry <= reviewed ||
      expiry - reviewed > 30 * 86400_000
    )
      problems.push("INVALID_EXCEPTION_WINDOW");
  }
  return problems;
}

export function evaluateGithubAlerts({
  alerts,
  analyses,
  expectedRef,
  expectedSha,
  exceptions = [],
  apiOk = true,
  now = new Date().toISOString(),
}) {
  const blocked = !apiOk;
  const findings = [];
  const reasons = [];

  if (blocked)
    reasons.push(
      "API_ERROR: alert/analysis fetch failed; not a zero-alert result",
    );

  if (!expectedRef || !expectedSha)
    reasons.push("MISSING_TARGET: ref and SHA are required");
  if (
    !Array.isArray(analyses) ||
    !Array.isArray(alerts) ||
    !Array.isArray(exceptions)
  )
    return {
      passed: false,
      blocked: true,
      gateReasons: ["INVALID_PAYLOAD"],
      alerts: [],
      expectedRef,
      expectedSha,
      checkedAt: now,
    };
  const exact = analyses.filter(
    (a) => a?.commit_sha === expectedSha && a.ref === expectedRef,
  );
  if (!analyses.length)
    reasons.push("MISSING_ANALYSIS: no analysis results at all");
  else if (!exact.length)
    reasons.push("STALE_SHA: no analysis on the exact expected SHA and ref");
  for (const category of ANALYSIS_CATEGORIES) {
    const matching = exact
      .filter((a) => a.category === category && a.tool?.name === "CodeQL")
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    if (!matching.length) reasons.push("CATEGORY_MISSING: " + category);
    else if (
      typeof matching[0].error !== "string" ||
      matching[0].error.length > 0 ||
      matching[0].rules_count === 0
    )
      reasons.push("ANALYSIS_FAILED: " + category);
  }

  const activeExceptions = new Map();
  for (const ex of exceptions) {
    const problems = exceptionProblems(ex, now);
    if (problems.length) {
      findings.push({
        number: ex.number,
        tool: "exception",
        state: "needs_validation",
        reasons: problems,
      });
      continue;
    }
    if (activeExceptions.has(ex.number))
      reasons.push("DUPLICATE_EXCEPTION: " + ex.number);
    activeExceptions.set(ex.number, ex);
  }

  for (const alert of alerts) {
    const mapping =
      ALERT_MAPPING[alert.number] ?? ALERT_MAPPING[String(alert.number)];
    const severity =
      alert.rule?.security_severity_level ??
      alert.security_severity_level ??
      "unknown";
    const tool = alert.tool ?? "code-scanning";
    const entry = {
      number: alert.number,
      tool,
      rule: alert.rule?.id ?? alert.rule ?? null,
      severity,
      state: "needs_validation",
      mapped: Boolean(mapping),
      reasons: [],
      ...(alert.evidence ? { evidence: alert.evidence } : {}),
    };

    if (!mapping) {
      entry.reasons.push("UNMAPPED_ALERT: no package/PR/test evidence");
    }
    if (
      severity === "unknown" ||
      (!alert.rule?.security_severity_level && tool === "code-scanning")
    ) {
      if (severity === "unknown")
        entry.reasons.push("CATEGORY_MISSING: severity/category unavailable");
    }

    const instance = alert.most_recent_instance;
    // An instance from another ref is always stale. On the SAME ref,
    // GitHub pins a fixed alert's surviving instance to the LAST
    // analysis that contained it — an older SHA — while the alert is
    // gone from the latest analysis (observed on PR #6: alerts 17-29
    // stayed listed at 351a638 after the fixes landed). "Fixed earlier
    // on this ref, absent from the verified exact-SHA analysis" is the
    // same evidence as absent-from-ref, so only non-fixed instances at
    // an older SHA are stale. The exact-SHA/ref analyses for BOTH
    // categories must still succeed (checked above) before any alert
    // can be labeled fixed_verified.
    if (instance && instance.ref !== expectedRef)
      entry.reasons.push("STALE_ALERT_INSTANCE");
    else if (
      instance &&
      instance.commit_sha !== expectedSha &&
      instance.state !== "fixed"
    )
      entry.reasons.push("STALE_ALERT_INSTANCE");
    if (alert.state === "fixed") {
      if (blocked || reasons.length > 0)
        entry.reasons.push("UNVERIFIED_ANALYSIS");
      else if (entry.reasons.length === 0) entry.state = "fixed_verified";
    } else if (activeExceptions.has(alert.number)) {
      if (entry.reasons.length === 0) entry.state = "risk_accepted";
    } else if (
      alert.state === "dismissed" ||
      alert.state === "auto_dismissed"
    ) {
      entry.reasons.push("UNREVIEWED_DISMISSAL");
    } else if (alert.state === "open") {
      entry.reasons.push(
        "OPEN_ALERT: no fixed-verified evidence on " + expectedSha,
      );
    }

    // Every required alert must end fixed_verified or risk_accepted.
    if (
      mapping?.required &&
      entry.state !== "fixed_verified" &&
      entry.state !== "risk_accepted"
    )
      entry.reasons.push("REQUIRED_NOT_RESOLVED");

    findings.push(entry);
  }

  const unresolved = findings.filter((f) => f.reasons.length > 0);
  const passed =
    !blocked &&
    reasons.length === 0 &&
    unresolved.length === 0 &&
    findings.every(
      (f) => f.state === "fixed_verified" || f.state === "risk_accepted",
    );

  return {
    passed,
    blocked: blocked || reasons.length > 0,
    checkedAt: now,
    expectedRef,
    expectedSha,
    gateReasons: reasons,
    alerts: findings,
    summary: {
      total: findings.length,
      fixed_verified: findings.filter((f) => f.state === "fixed_verified")
        .length,
      risk_accepted: findings.filter((f) => f.state === "risk_accepted").length,
      needs_validation: findings.filter((f) => f.state === "needs_validation")
        .length,
    },
  };
}
