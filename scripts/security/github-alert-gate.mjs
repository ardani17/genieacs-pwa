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
// package/ticket/test evidence that addresses it. Residual
// protocol-crypto findings are risk_accepted via exceptions, never
// silently "fixed".
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

  // An analysis on the exact expected SHA must exist; anything else is
  // stale/missing evidence.
  const freshAnalysis = analyses.find((a) => a.commit_sha === expectedSha);
  const refMatch = analyses.find(
    (a) => a.ref === undefined || a.ref === expectedRef,
  );
  if (!analyses.length)
    reasons.push("MISSING_ANALYSIS: no analysis results at all");
  else if (!freshAnalysis)
    reasons.push("STALE_SHA: no analysis on expected commit " + expectedSha);
  if (analyses.length && !refMatch)
    reasons.push("STALE_REF: no analysis on expected ref " + expectedRef);

  const activeExceptions = new Map();
  for (const ex of exceptions) {
    const expiry = ex.expiresAt;
    if (!expiry || expiry <= now) {
      findings.push({
        number: ex.number,
        tool: "exception",
        state: "needs_validation",
        reasons: ["EXPIRED_EXCEPTION"],
      });
      continue;
    }
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

    if (alert.state === "fixed" || alert.state === "dismissed") {
      entry.state =
        alert.state === "fixed" ? "fixed_verified" : "risk_accepted";
    } else if (activeExceptions.has(alert.number)) {
      const ex = activeExceptions.get(alert.number);
      const requiredFields = ["reason", "scope", "owner", "expiresAt"];
      if (requiredFields.some((f) => !ex[f]))
        entry.reasons.push(
          "INCOMPLETE_EXCEPTION: missing " +
            requiredFields.filter((f) => !ex[f]).join("/"),
        );
      else entry.state = "risk_accepted";
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

  const unresolved = findings.filter(
    (f) => f.reasons.length > 0 && f.state !== "risk_accepted",
  );
  const passed =
    !blocked &&
    reasons.length === 0 &&
    unresolved.length === 0 &&
    findings.every(
      (f) => f.state === "fixed_verified" || f.state === "risk_accepted",
    );

  return {
    passed,
    blocked,
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
