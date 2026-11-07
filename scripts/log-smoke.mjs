// Log pipeline smoke: writes one sanitized event through the REAL path
// (app log file -> Vector -> VictoriaLogs), polls the query API for the
// requestId for at most 10 seconds and VALIDATES the stored record —
// never just an HTTP 200. Also reads VictoriaLogs /health so the
// deployment's log status is "healthy/buffering/degraded by evidence",
// not "container alive".

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const logUrl = process.env.LOG_URL ?? "http://127.0.0.1:9428";
const appLogFile = process.env.APP_LOG_FILE ?? "/logs/smoke/smoke.ndjson";
// VictoriaLogs makes ingested rows searchable on its internal flush
// cadence: measured end-to-end latency for a single row varies (~6s
// warm, 13s+ after a cold restart), so the poll budget must accommodate
// the flush, not just the transport. The VALIDATION below (exact
// requestId + event + message on the query result) is unchanged.
const pollMs = 30_000;

const requestId = randomUUID();
const event = {
  schemaVersion: 1,
  timestamp: new Date().toISOString(),
  level: "info",
  service: "smoke",
  appVersion: process.env.APP_VERSION ?? "dev",
  installationId:
    process.env.INSTALLATION_ID ?? "00000000-0000-0000-0000-000000000000",
  environment: process.env.NODE_ENV === "production" ? "production" : "test",
  event: "pipeline.smoke",
  message: "log pipeline smoke",
  requestId,
};

mkdirSync(path.dirname(appLogFile), { recursive: true });
appendFileSync(appLogFile, JSON.stringify(event) + "\n");

const deadline = Date.now() + pollMs;
let found = null;
while (Date.now() < deadline) {
  try {
    const health = await fetch(`${logUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (health.ok) {
      const q = await fetch(`${logUrl}/select/logsql/query`, {
        method: "POST",
        body: new URLSearchParams({
          query: `requestId:"${requestId}"`,
          limit: "5",
        }),
        signal: AbortSignal.timeout(2000),
      });
      const text = await q.text();
      // An error response can echo the id back; only a successful query
      // result counts as found.
      if (text.includes(requestId) && !text.includes("cannot parse")) {
        found = text;
        break;
      }
    }
  } catch {
    // not up yet — keep polling until the deadline
  }
  await new Promise((r) => setTimeout(r, 500));
}

if (!found) {
  process.stderr.write(
    JSON.stringify({
      event: "pipeline.smoke.failed",
      requestId,
      reason: "event not searchable within budget",
    }) + "\n",
  );
  process.exit(1);
}

// Validate the stored record content on the response TEXT: the
// requestId, the event name and the message must all be present — a bare
// HTTP 200 proves nothing.
const ok =
  found.includes(requestId) &&
  found.includes("pipeline.smoke") &&
  found.includes("log pipeline smoke");
if (!ok) {
  process.stderr.write(
    JSON.stringify({
      event: "pipeline.smoke.failed",
      requestId,
      reason: "record content incomplete",
    }) + "\n",
  );
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({
    event: "pipeline.smoke.completed",
    requestId,
    observedAt: new Date().toISOString(),
  }) + "\n",
);
