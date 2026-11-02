// Engine app-log adapter — DEGRADED-BUT-RUNNING contract: when the
// configured log directory cannot be created (here: a regular FILE
// occupies a path component), the adapter falls back to a no-op instead
// of ever throwing — logging must never take the engine down.
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Must exist before lib/config.ts is imported (dynamically, inside the
// test) — config parses GENIEACS_* at import time.
const blocker = path.join(tmpdir(), "engine-app-logger-blocker");
closeSync(openSync(blocker, "w"));
process.env.GENIEACS_UI_APP_LOG_FILE = path.join(blocker, "sub", "app.ndjson");

void test("unwritable log directory degrades to a no-op, never a throw", async () => {
  const { getEngineAppLogger, emitLoginOutcome } =
    await import("../lib/engine-app-logger.ts");
  const logger = getEngineAppLogger();
  logger.emit({ event: "x", level: "info", message: "ignored" });
  emitLoginOutcome(undefined, true, "admin");
  await logger.flush(100);
  assert.equal(logger.status().state, "healthy");
  rmSync(blocker, { force: true });
});
