// Run after stopping ONLY the check project's VictoriaLogs service. The
// fixed identity below belongs to the isolated fixture database.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const login = await fetch("http://ui:7583/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "Fixture-Only-2026!" }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
const headers = {
  Cookie: cookie,
  "Content-Type": "application/json",
  "X-Request-Id": randomUUID(),
};
const query = await fetch("http://ui:7583/api/app/logs", {
  method: "POST",
  headers,
  body: JSON.stringify({ limit: 1 }),
  signal: AbortSignal.timeout(7000),
});
assert.equal(query.status, 503);
const health = await fetch("http://web:3000/api/app/health", {
  signal: AbortSignal.timeout(5000),
});
assert.equal(health.status, 200);
const logging = await fetch("http://ui:7583/api/app/logs/status", {
  headers,
  signal: AbortSignal.timeout(5000),
});
assert.equal(logging.status, 200);
const data = (await logging.json()).data;
assert.ok(["buffering", "degraded"].includes(data.state));
const result = {
  queryStatus: query.status,
  dashboardStatus: health.status,
  loggingState: data.state,
  sinkReachable: data.sinkReachable,
};
mkdirSync("artifacts/m07-outage", { recursive: true });
writeFileSync(
  "artifacts/m07-outage/result.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
