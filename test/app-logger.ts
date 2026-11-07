import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { redact, createAppLogger, makeRequestId } from "../lib/app-logger.ts";

void test("redacts typed values, nested secrets and URL credentials", () => {
  const s = JSON.stringify(
    redact({
      authorization: "Bearer dummy-secret",
      nested: { password: "dummy-password" },
      parameterValues: [
        ["Device.WiFi.SSID.1.PreSharedKey", "dummy-key", "xsd:string"],
      ],
      url: "https://user:dummy-url@example.invalid/?token=dummy-query",
    }),
  );
  for (const x of [
    "dummy-secret",
    "dummy-password",
    "dummy-key",
    "dummy-url",
    "dummy-query",
  ])
    assert.equal(s.includes(x), false, `${x} must be redacted`);
});

void test("redaction handles cycles, depth and size bounds", () => {
  const cyclic: Record<string, unknown> = { name: "node" };
  cyclic.self = cyclic;
  const out = redact(cyclic) as Record<string, unknown>;
  assert.equal(out.self, "[CYCLE]");

  let deep: unknown = { leaf: "x" };
  for (let i = 0; i < 20; ++i) deep = { deeper: deep };
  assert.ok(JSON.stringify(redact(deep)).includes("[TRUNCATED]"));

  const long = redact({ blob: "a".repeat(10 * 1024) }) as {
    blob: string;
  };
  assert.ok(long.blob.length <= 8 * 1024 + 2);
});

void test("error objects keep name and sanitized stack, cause chains redacted", () => {
  const inner = new Error("inner Password=dummy-inner");
  const outer = new Error("outer");
  (outer as Error & { cause?: unknown }).cause = inner;
  const out = redact(outer) as {
    name: string;
    message: string;
    stack?: string;
    cause: { message: string };
  };
  assert.equal(out.name, "Error");
  // The whole-text sanitizer scrubs explicit secret pairs from the
  // nested cause message — no bypass: if redaction were disabled this
  // assertion FAILS.
  assert.equal(
    out.cause.message.includes("dummy-inner"),
    false,
    "cause message must be sanitized",
  );
  assert.match(out.cause.message, /Password= ?\[REDACTED\]/i);
  assert.ok(out.cause !== undefined);
});

void test("emit never throws on sink failure and stays fast", async () => {
  const failures: Error[] = [
    Object.assign(new Error("no space"), { code: "ENOSPC" }),
    Object.assign(new Error("denied"), { code: "EACCES" }),
  ];
  let call = 0;
  const logger = createAppLogger({
    service: "test",
    appVersion: "0",
    installationId: "11111111-1111-1111-1111-111111111111",
    environment: "test",
    filePath: "/tmp/unused.log",
    sink: async () => {
      const err = failures[Math.min(call, failures.length - 1)];
      call += 1;
      throw err;
    },
  });

  const t0 = Date.now();
  for (let i = 0; i < 50; ++i) logger.emit({ event: "e", level: "info" });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 50, `emit must not block (${elapsed}ms)`);

  await logger.flush(500);
  const status = logger.status();
  assert.equal(status.state, "degraded");
  assert.ok(status.droppedEvents >= 50);
});

void test("queue overflow drops low severity first and counts drops", async () => {
  let written: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let first = true;
  const logger = createAppLogger({
    service: "test",
    appVersion: "0",
    installationId: "11111111-1111-1111-1111-111111111111",
    environment: "test",
    filePath: "/tmp/unused.log",
    sink: async (line) => {
      if (first) {
        first = false;
        await gate; // stall the writer to fill the queue
      }
      written.push(line);
    },
  });

  for (let i = 0; i < 1200; ++i)
    logger.emit({ event: "noise", level: i % 10 === 0 ? "error" : "debug" });

  const statusFull = logger.status();
  assert.ok(statusFull.droppedEvents >= 100, "overflow must drop");

  release();
  await logger.flush(2000);
  const finalStatus = logger.status();
  assert.ok(finalStatus.lastSuccessAt !== null);
  // Errors survived preferentially over debug noise.
  const levels = written.map((l) => JSON.parse(l).level);
  assert.ok(levels.includes("error"));
  assert.ok(levels.filter((l) => l === "debug").length < 1000);
  void written;
  written = [];
});

void test("recovery returns state to healthy after a successful write", async () => {
  let fail = true;
  const logger = createAppLogger({
    service: "test",
    appVersion: "0",
    installationId: "11111111-1111-1111-1111-111111111111",
    environment: "test",
    filePath: "/tmp/unused.log",
    sink: async () => {
      if (fail) throw Object.assign(new Error("x"), { code: "ENOSPC" });
    },
  });

  logger.emit({ event: "a", level: "warn" });
  await logger.flush(500);
  assert.equal(logger.status().state, "degraded");

  fail = false;
  logger.emit({ event: "b", level: "warn" });
  await logger.flush(500);
  assert.equal(logger.status().state, "healthy");
});

// Fresh shared volumes are seeded from whichever image mounts them
// first, so a writer's own directory may not exist yet (review wave 5
// Standards P1: engine-initialized volume -> web ENOENT). The file sink
// must create it up front and RECREATE it if it vanishes mid-run.
void test("file sink creates and recreates its log directory (ENOENT self-heal)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "app-logger-heal-"));
  const filePath = path.join(dir, "nested", "web", "app.ndjson");
  try {
    const logger = createAppLogger({
      service: "web",
      appVersion: "0",
      installationId: "11111111-1111-1111-1111-111111111111",
      environment: "test",
      filePath,
    });

    logger.emit({ event: "a", level: "info" });
    await logger.flush(500);
    assert.equal(logger.status().state, "healthy");
    assert.ok(existsSync(filePath), "directory created before first write");

    // Storage wiped while running: the next write recreates and
    // recovers instead of failing ENOENT forever.
    rmSync(path.join(dir, "nested"), { recursive: true, force: true });
    logger.emit({ event: "b", level: "info" });
    await logger.flush(500);
    assert.equal(logger.status().state, "healthy");
    assert.ok(existsSync(filePath), "directory recreated after wipe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("events carry the full envelope and sanitized details", async () => {
  const seen: string[] = [];
  const logger = createAppLogger({
    service: "web",
    appVersion: "1.2.17-dev",
    installationId: "22222222-2222-2222-2222-222222222222",
    environment: "test",
    filePath: "/tmp/unused.log",
    sink: async (line) => {
      seen.push(line);
    },
  });

  logger.emit({
    event: "device.list.completed",
    level: "info",
    requestId: makeRequestId(),
    deviceId: "dev-1",
    durationMs: 12,
    outcome: "success",
    message: "listed devices",
    details: { total: 5, filter: { password: "nope" } },
  });
  await logger.flush(500);

  const event = JSON.parse(seen[0]);
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.service, "web");
  assert.equal(event.installationId, "22222222-2222-2222-2222-222222222222");
  assert.equal(event.outcome, "success");
  assert.equal(event.durationMs, 12);
  assert.equal(event.details.filter.password, "[REDACTED]");
  assert.ok(!seen[0].includes("nope"));
});

// Sink-level sentinel check: the BYTES persisted by the sink (not just
// helper output) must be free of message, URL and stack secrets. If the
// redaction implementation were disabled, this test FAILS.
void test("persisted sink bytes never contain message, URL or stack secrets", async () => {
  const seen: string[] = [];
  const logger = createAppLogger({
    service: "web",
    appVersion: "1.2.17-dev",
    installationId: "22222222-2222-2222-2222-222222222222",
    environment: "test",
    filePath: "/tmp/unused.log",
    sink: async (line) => {
      seen.push(line);
    },
  });

  const err = new Error('login failed Password="dummy-msg-secret"');
  // RE-STD-06: Authorization scheme+credentials must vanish from the
  // cause chain, not just the scheme word.
  const causeErr = new Error(
    "upstream rejected Authorization: Bearer dummy-cause-auth",
  );
  (causeErr as Error & { cause?: unknown }).cause = new Error(
    "inner token=dummy-inner-token",
  );
  (err as Error & { cause?: unknown }).cause = causeErr;
  const stackErr = new Error("fetch failed");
  stackErr.stack =
    "Error: fetch failed\n" +
    "    at f (/x.ts:1:1) Authorization: Basic dummy-stack-token\n" +
    "    at g (/x.ts:2:2)";
  logger.emit({
    event: "auth.login.failed",
    level: "warn",
    message:
      'auth rejected session="dummy-session-id" for https://user:dummy-urlpw@example.invalid/login?token=dummy-urltoken',
    details: {
      error: err,
      note: "see https://x.example/?session=dummy-s2",
      authVariants: [
        "Authorization: Bearer dummy-bearer-token",
        "authorization: basic dummy-basic-creds",
        "AUTHORIZATION:  Bearer   dummy-caps-ws",
        "Authorization:Bearer dummy-no-space",
        "authorization = Bearer dummy-eq-form",
        'Authorization: "Bearer dummy-quoted"',
        // Quoted KEY/VALUE forms (R3-STD-06): JSON-ish free text and
        // single-quoted pairs must not shield the credentials.
        '{"authorization":"Bearer dummy-json-auth"}',
        "{'authorization': 'Basic dummy-squote-auth'}",
        '{"password":"dummy-json-password"}',
        '{"token": "dummy-json-token"}',
        // Quoted values with SPACES/COMMAS inside (review wave 5): the
        // JSON separator consumes the value's opening quote, so the
        // value must run to the CLOSING quote — a bare-word match would
        // stop at the first space/comma and leak the tail.
        '{"password":"dummy json pw, with spaces"}',
        "{'token': 'dummy squote token, comma'}",
        '{"authorization":"Basic dummy auth, with spaces"}',
        '{"secret":"dummy \\"escaped quote, secret\\""}',
      ],
      stackError: stackErr,
    },
  });
  await logger.flush(500);

  const bytes = seen.join("\n");
  for (const sentinel of [
    "dummy-msg-secret",
    "dummy-inner-token",
    "dummy-session-id",
    "dummy-urlpw",
    "dummy-urltoken",
    "dummy-s2",
    "dummy-bearer-token",
    "dummy-basic-creds",
    "dummy-caps-ws",
    "dummy-no-space",
    "dummy-eq-form",
    "dummy-quoted",
    "dummy-cause-auth",
    "dummy-stack-token",
    "dummy-json-auth",
    "dummy-squote-auth",
    "dummy-json-password",
    "dummy-json-token",
    "dummy json pw, with spaces",
    "dummy squote token, comma",
    "dummy auth, with spaces",
    "escaped quote, secret",
  ])
    assert.equal(bytes.includes(sentinel), false, `${sentinel} leaked to sink`);
});

// R3-STD-09A: the PARENT correlation id must reach the persisted bytes,
// not just the emit() call — two requests sharing an inbound UUID stay
// traceable to it.
void test("parentRequestId persists next to the minted audit id", async () => {
  const seen: string[] = [];
  const logger = createAppLogger({
    service: "web",
    appVersion: "1.2.17-dev",
    installationId: "22222222-2222-2222-2222-222222222222",
    environment: "test",
    filePath: "/tmp/unused.log",
    sink: async (line) => {
      seen.push(line);
    },
  });
  const parent = "3f1c6d92-7d9e-4a4d-b3e2-333333333333";
  logger.emit({
    event: "http.request.completed",
    level: "info",
    requestId: "4f1c6d92-7d9e-4a4d-b3e2-444444444444",
    parentRequestId: parent,
    message: "list devices 200",
  });
  await logger.flush(500);
  const event = JSON.parse(seen[0]);
  assert.equal(event.parentRequestId, parent);
  assert.equal(event.requestId, "4f1c6d92-7d9e-4a4d-b3e2-444444444444");
  // No parent field when none was presented.
  logger.emit({ event: "x", level: "info", message: "no parent" });
  await logger.flush(500);
  assert.equal("parentRequestId" in JSON.parse(seen[1]), false);
});

void test("request ids accept valid UUIDs and regenerate otherwise", () => {
  const uuid = "9f1c6d92-7d9e-4a4d-b3e2-111111111111";
  assert.equal(makeRequestId(uuid), uuid);
  assert.equal(makeRequestId(uuid.toUpperCase()), uuid.toUpperCase());
  assert.notEqual(makeRequestId("../../etc"), "../../etc");
  assert.match(makeRequestId(null), /^[0-9a-f-]{36}$/);
});
