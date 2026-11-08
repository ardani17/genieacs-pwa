import test from "node:test";
import assert from "node:assert/strict";
import { readLogResults } from "../lib/ui/log-results.ts";
import { buildLogQuery } from "../lib/ui/log-query.ts";
import { vectorCounters, storageMetrics } from "../lib/ui/logging-status.ts";
void test("search/export redact sink data again and enforce record caps", async () => {
  const data = [
    {
      message: "failure password=fixture-secret",
      details: {
        password: "fixture-secret",
        nested: { token: "fixture-token" },
      },
    },
    { event: "extra" },
  ];
  const text = await readLogResults(
    new Response(data.map((r) => JSON.stringify(r)).join("\n")),
    1,
  );
  assert.equal(text.includes("fixture-secret"), false);
  assert.equal(text.includes("fixture-token"), false);
  assert.equal(text.trim().split("\n").length, 1);
  await assert.rejects(readLogResults(new Response("malformed fixture"), 100));
});
void test("log filters reject unknown fields, type coercion and oversized values", () => {
  for (const raw of [
    null,
    [],
    { limit: "100" },
    { host: "localhost" },
    { requestId: [] },
    { requestId: "x".repeat(257) },
  ])
    assert.throws(() => buildLogQuery(raw as never), /VALIDATION/);
});
void test("logging health reads real Vector counter names without exposing metric labels", () => {
  assert.deepEqual(
    vectorCounters(
      'vector_buffer_size_bytes{component_id="victorialogs"} 1024\nvector_component_discarded_events_total{component_id="validate_and_redact"} 2\nvector_component_errors_total{component_id="victorialogs"} 3\n# HELP example',
    ),
    { bufferBytes: 1024, droppedEvents: 2, errors: 3 },
  );
});
void test("storage warnings use observed bytes at 80/90 percent and free space below 2GiB", () => {
  const metrics = (used: number, free = 3 * 1024 ** 3): string =>
    `vl_data_size_bytes{type="storage"} ${used}\nvl_data_size_bytes{type="indexdb"} 0\nvl_free_disk_space_bytes{path="/storage"} ${free}`;
  assert.equal(storageMetrics(metrics(7999999999)).level, "normal");
  assert.equal(storageMetrics(metrics(8000000000)).level, "warning");
  assert.equal(storageMetrics(metrics(9000000000)).level, "critical");
  assert.equal(storageMetrics(metrics(1, 2 * 1024 ** 3 - 1)).level, "critical");
  assert.equal(storageMetrics("").level, "unknown");
});
