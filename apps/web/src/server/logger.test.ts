// Web logger regression (review wave 5 Standards P1): a fresh shared
// log volume is seeded from whichever image mounts it first — when the
// engine initializes it, /logs/web is absent in the web container and
// writes used to fail ENOENT forever. The web logger must create its
// own directory through the shared core and stay healthy.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { getAppLogger } from "./logger";

const dir = mkdtempSync(path.join(tmpdir(), "web-logger-heal-"));
const logFile = path.join(dir, "web", "app.ndjson");
process.env.APP_LOG_FILE = logFile;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("web logger creates its missing log directory and reports healthy", async () => {
  const logger = getAppLogger();
  logger.emit({ event: "web.selftest", level: "info", message: "heal" });
  await logger.flush(1000);
  expect(logger.status().state).toBe("healthy");
  expect(logger.status().droppedEvents).toBe(0);
  expect(existsSync(logFile)).toBe(true);
});
