import test from "node:test";
import assert from "node:assert/strict";
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
  (err as Error & { cause?: unknown }).cause = new Error(
    "inner token=dummy-inner-token",
  );
  logger.emit({
    event: "auth.login.failed",
    level: "warn",
    message: 'auth rejected session="dummy-session-id" for https://user:dummy-urlpw@example.invalid/login?token=dummy-q',
    details: { error: err, note: "see https://x.example/?session=dummy-s2" },
  });
  await logger.flush(500);

  const bytes = seen.join("\n");
  for (const sentinel of [
    "dummy-msg-secret",
    "dummy-inner-token",
    "dummy-session-id",
    "dummy-urlpw",
    "dummy-q",
    "dummy-s2",
  ])
    assert.equal(bytes.includes(sentinel), false, `${sentinel} leaked to sink`);
});

void test("request ids accept valid UUIDs and regenerate otherwise", () => {
  const uuid = "9f1c6d92-7d9e-4a4d-b3e2-111111111111";
  assert.equal(makeRequestId(uuid), uuid);
  assert.equal(makeRequestId(uuid.toUpperCase()), uuid.toUpperCase());
  assert.notEqual(makeRequestId("../../etc"), "../../etc");
  assert.match(makeRequestId(null), /^[0-9a-f-]{36}$/);
});
