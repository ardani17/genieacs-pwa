// Engine app-log adapter — DEFAULT-OFF contract (RE-STD-09B): with no
// UI_APP_LOG_FILE configured every call is a no-op and NOTHING is
// written, so bare-CLI/upstream engine behavior stays byte-identical.
// (The enabled path is exercised end-to-end by
// test/integration/auth-log-events.ts against the real listener.)
//
// lib/config.ts parses GENIEACS_* at import time, so lib modules are
// imported DYNAMICALLY inside the tests — the static imports above are
// stdlib-only and safe to hoist.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

void test("engine adapter is a no-op unless UI_APP_LOG_FILE is set", async () => {
  const { getEngineAppLogger } = await import("../lib/engine-app-logger.ts");
  const logger = getEngineAppLogger();
  // emit/flush never throw and touch nothing.
  logger.emit({
    event: "auth.login_failed",
    level: "warn",
    message: "login failed",
    outcome: "failure",
  });
  await logger.flush(500);
  assert.equal(logger.status().state, "healthy");
  assert.equal(logger.status().droppedEvents, 0);
  // No sink file materialized anywhere plausible for this process.
  assert.equal(existsSync("/logs/ui/app.ndjson"), false);
});

void test("correlation helpers stay no-op-safe through the disabled adapter", async () => {
  const { emitLoginOutcome, emitPermissionDenied } =
    await import("../lib/engine-app-logger.ts");
  // Must not throw even with a context carrying a valid request id.
  emitLoginOutcome(
    { get: () => "9f1c6d92-7d9e-4a4d-b3e2-111111111111" },
    false,
    "admin",
  );
  emitPermissionDenied(undefined, "Delete preset");
});
