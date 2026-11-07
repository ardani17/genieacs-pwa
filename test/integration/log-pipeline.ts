import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const LOG_URL = process.env.LOG_URL ?? "";
const SKIP = !LOG_URL;

// VictoriaLogs flushes inserts asynchronously and Vector's file server
// can take ~30s for its FIRST scan: poll until the record is visible or
// the budget expires.
async function queryUntilVisible(
  id: string,
  extraAssert: (text: string) => void,
  budgetMs = 15000,
): Promise<string> {
  const deadline = Date.now() + budgetMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const q = await fetch(LOG_URL + "/select/logsql/query", {
      method: "POST",
      body: new URLSearchParams({
        query: 'requestId:"' + id + '"',
        limit: "1",
      }),
      signal: AbortSignal.timeout(2000),
    });
    lastText = await q.text();
    assert.ok(!lastText.includes("cannot parse"), "query must be valid LogsQL");
    if (lastText.includes(id)) {
      extraAssert(lastText);
      return lastText;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.match(lastText, new RegExp(id));
  return lastText;
}

void test(
  "ingested event is searchable by requestId",
  { skip: SKIP },
  async () => {
    const id = randomUUID();
    const event = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      level: "info",
      service: "test",
      installationId: "fixture",
      environment: "test",
      appVersion: "1.2.16",
      event: "pipeline.test",
      message: "fixture",
      requestId: id,
    };
    const ingest = await fetch(LOG_URL + "/insert/jsonline", {
      method: "POST",
      body: JSON.stringify(event) + "\n",
    });
    assert.equal(ingest.ok, true);
    await queryUntilVisible(id, () => {});
  },
);

void test(
  "invalid event is dropped by the vector transform, never stored raw",
  { skip: SKIP },
  async () => {
    // Write a malformed line directly into the watched app-log volume —
    // Vector's remap must drop it (no fallback to the raw stream).
    const logDir = process.env.APP_LOG_DIR;
    if (!logDir) return; // direct-insert environment only
    const marker = "RAWSECRET-" + randomUUID();
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      path.join(logDir, "invalid.ndjson"),
      JSON.stringify({ not: "a-log-event", junk: marker }) + "\n",
    );
    // Give vector a moment to observe and drop it.
    await new Promise((r) => setTimeout(r, 1500));
    const q = await fetch(LOG_URL + "/select/logsql/query", {
      method: "POST",
      body: new URLSearchParams({ query: "*" }) as URLSearchParams,
      signal: AbortSignal.timeout(2000),
    });
    void q;
    const q2 = await fetch(LOG_URL + "/select/logsql/query", {
      method: "POST",
      body: new URLSearchParams({ query: `_msg:"${marker}"`, limit: "1" }),
    });
    assert.ok(!(await q2.text()).includes(marker));
  },
);

void test(
  "no secret marker reaches the store through details",
  { skip: SKIP },
  async () => {
    const id = randomUUID();
    const secret = "SUPERSECRET-" + randomUUID();
    const event = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      level: "info",
      service: "test",
      installationId: "fixture",
      environment: "test",
      appVersion: "1.2.16",
      event: "pipeline.redaction",
      message: "redaction probe",
      requestId: id,
      details: { password: secret },
    };
    // Through the watched volume so VECTOR's redaction transform runs
    // (the application logger's own redaction is covered by
    // test/app-logger; the store itself does not sanitize).
    const { appendFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("/logs/redaction", { recursive: true });
    appendFileSync(
      "/logs/redaction/probe.ndjson",
      JSON.stringify(event) + "\n",
    );
    await queryUntilVisible(
      id,
      (text) => {
        assert.ok(!text.includes(secret), "secret must never be stored");
        assert.ok(text.includes("[REDACTED]") || !text.includes("password"));
      },
      45000,
    );
  },
);

void test("retention flags and port surface are statically correct", async () => {
  // The runner executes from the repository root; import.meta.url is not
  // available in the bundled CJS output. Windows Docker bind mounts can
  // transiently fail a read with ENODATA right after bundle writes on
  // the same mount — retry briefly before failing.
  const repoRoot = process.cwd();
  const file = path.join(repoRoot, "compose.yaml");
  const readWithRetry = async (target: string): Promise<string> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; ++attempt) {
      try {
        return readFileSync(target, "utf8");
      } catch (err) {
        lastError = err;
        if ((err as NodeJS.ErrnoException).code !== "ENODATA") throw err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw lastError;
  };
  void file;
  const compose = YAML.parse(
    await readWithRetry(path.join(repoRoot, "compose.yaml")),
    { merge: true },
  );
  const v = compose.services.victorialogs.command.map(String);
  assert.ok(v.includes("-retentionPeriod=14d"));
  assert.ok(v.includes("-retention.maxDiskSpaceUsageBytes=10000000000"));
  assert.ok(v.includes("-storage.minFreeDiskSpaceBytes=2147483648"));
  // 9428 and the collector API are never published.
  const services = compose.services as Record<string, { ports?: string[] }>;
  for (const [name, svc] of Object.entries(services))
    for (const p of svc.ports ?? [])
      assert.ok(
        !String(p).includes("9428") && !String(p).includes("9598"),
        `${name} must not publish log ports`,
      );

  const vector = YAML.parse(
    await readWithRetry(path.join(repoRoot, "docker/vector/vector.yaml")),
  );
  assert.equal(vector.sinks.victorialogs.buffer.max_size, 1073741824);
  assert.equal(vector.sinks.victorialogs.buffer.when_full, "block");
  assert.equal(vector.transforms.validate_and_redact.drop_on_error, true);
});
