// Engine app-log adapter — DEGRADED-BUT-VISIBLE contract: when the
// configured log directory cannot be created (here: a regular FILE
// occupies a path component), writes fail but are COUNTED and reported
// as "degraded" — never a silent "healthy" — and the SAME logger
// instance heals by itself once the blocker is gone. Logging must never
// take the engine down, and lost events must never be invisible.
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Must exist before lib/config.ts is imported (dynamically, inside the
// test) — config parses GENIEACS_* at import time. The blocker lives in
// a unique mkdtemp directory: a predictable shared tmp path is a
// symlink/interference hazard, and parallel runs would collide.
const base = mkdtempSync(path.join(tmpdir(), "engine-app-logger-broken-"));
const blocker = path.join(base, "blocker");
const logFile = path.join(blocker, "sub", "app.ndjson");
closeSync(openSync(blocker, "w"));
process.env.GENIEACS_UI_APP_LOG_FILE = logFile;

void test("unwritable log directory degrades visibly, counts drops, then recovers", async () => {
  const { getEngineAppLogger, emitLoginOutcome } =
    await import("../lib/engine-app-logger.ts");
  const logger = getEngineAppLogger();
  logger.emit({ event: "x", level: "info", message: "ignored" });
  emitLoginOutcome(undefined, true, "admin");
  await logger.flush(500);

  // Failed writes are REPORTED, not hidden: degraded state plus a
  // counted loss for every dropped event.
  const broken = logger.status();
  assert.equal(broken.state, "degraded");
  assert.ok(broken.droppedEvents >= 2, "lost events must be counted");
  assert.equal(existsSync(logFile), false);

  // Storage repaired: the cached logger self-heals on its next write.
  rmSync(blocker, { force: true });
  logger.emit({ event: "y", level: "info", message: "recovered" });
  await logger.flush(1000);
  assert.equal(logger.status().state, "healthy");
  assert.ok(existsSync(logFile), "log file written after recovery");

  rmSync(base, { recursive: true, force: true });
});
