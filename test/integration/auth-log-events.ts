// Engine structured-log integration (RE-STD-09B): with UI_APP_LOG_FILE
// configured, the REAL native listener emits sanitized auth/permission
// events to the shared NDJSON sink — in PARALLEL to the legacy logger —
// carrying the x-request-id the BFF forwards, so engine events join the
// BFF's by requestId. Run in the check environment (fixture database).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Must be set before lib/config.ts is imported (dynamically, inside the
// test via the helper): config parses GENIEACS_* at import time.
const logFile = path.join(tmpdir(), `engine-auth-events-${process.pid}.ndjson`);
process.env.GENIEACS_UI_APP_LOG_FILE = logFile;

function readEvents(): Record<string, unknown>[] {
  try {
    return readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

void test("login outcomes and permission denials land as sanitized service:ui events", async () => {
  const { startApp, FIXTURE_PASSWORD } = await import("../helpers/app.ts");
  const app = await startApp();
  try {
    const failedId = randomUUID();
    const failed = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": failedId },
      body: JSON.stringify({ username: "admin", password: "definitely-wrong" }),
    });
    assert.equal(failed.status, 400);

    const okId = randomUUID();
    const ok = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": okId },
      body: JSON.stringify({ username: "admin", password: FIXTURE_PASSWORD }),
    });
    assert.equal(ok.status, 200);

    const deniedId = randomUUID();
    const denied = await app.appRequest(
      "/api/permissions",
      { headers: { "x-request-id": deniedId } },
      "restricted",
    );
    assert.ok(
      [401, 403].includes(denied.status),
      `unexpected ${denied.status}`,
    );

    // The sink is flushed asynchronously: wait until ALL THREE correlated
    // ids are present (the restricted identity's own login also emits an
    // uncorrelated event, so a plain count would race ahead of the
    // denial).
    const wanted = new Set<string>([failedId, okId, deniedId]);
    let events: Record<string, unknown>[] = [];
    for (let i = 0; i < 75; ++i) {
      events = readEvents();
      const seen = new Set(
        events
          .map((e) => e.requestId)
          .filter((r): r is string => typeof r === "string")
          .filter((r) => wanted.has(r)),
      );
      if (wanted.size === seen.size) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const byId = (id: string): Record<string, unknown>[] =>
      events.filter((e) => e.requestId === id);
    const failedEvents = byId(failedId);
    assert.ok(failedEvents.length >= 1, "login_failed event with requestId");
    assert.equal(failedEvents[0].event, "auth.login_failed");
    assert.equal(failedEvents[0].service, "ui");
    assert.equal(failedEvents[0].actorId, "admin");
    // The submitted password must never reach the sink.
    assert.equal(JSON.stringify(events).includes("definitely-wrong"), false);

    const okEvents = byId(okId);
    assert.ok(okEvents.length >= 1, "login_succeeded event with requestId");
    assert.equal(okEvents[0].event, "auth.login_succeeded");
    assert.equal(okEvents[0].outcome, "success");

    const deniedEvents = byId(deniedId);
    assert.ok(
      deniedEvents.length >= 1,
      "permission_denied event with requestId",
    );
    // The contract event name is permission.denied; the auth.* alias
    // is emitted alongside it (both carry the same correlation).
    const deniedNames = deniedEvents.map((e) => e.event).sort();
    assert.ok(deniedNames.includes("permission.denied"));
    assert.ok(deniedNames.includes("auth.permission_denied"));
    assert.equal(deniedEvents[0].service, "ui");
    // Every persisted row is a complete envelope.
    for (const e of events) {
      assert.equal(e.schemaVersion, 1);
      assert.equal(typeof e.timestamp, "string");
      assert.equal(e.service, "ui");
    }
  } finally {
    await app.stop();
    rmSync(logFile, { force: true });
  }
});
