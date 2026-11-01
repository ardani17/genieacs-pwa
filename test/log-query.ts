import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLogQuery,
  LOG_WINDOW_MAX_MS,
  LOG_LIMIT_MAX,
  LOG_OFFSET_MAX,
} from "../lib/ui/log-query.ts";

void test("log query rejects unbounded windows and raw expressions", () => {
  assert.throws(
    () => buildLogQuery({ start: "2026-01-01", end: "2026-11-01" }),
    /VALIDATION/,
  );
  assert.throws(
    () => buildLogQuery({ query: "* | delete" } as never),
    /VALIDATION/,
  );
  const q = buildLogQuery({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
  });
  assert.equal(q.limit, 100);
});

void test("window, paging and field guards", () => {
  const now = Date.now();
  // Default window: 15 minutes.
  const d = buildLogQuery({});
  assert.ok(Date.parse(d.end) - Date.parse(d.start) <= 15 * 60 * 1000 + 1000);

  // Max window exactly 24h is allowed.
  const ok24 = buildLogQuery({
    start: new Date(now - LOG_WINDOW_MAX_MS).toISOString(),
    end: new Date(now).toISOString(),
  });
  assert.ok(ok24.query.length > 0);

  assert.throws(
    () => buildLogQuery({ limit: LOG_LIMIT_MAX + 1 }),
    /VALIDATION/,
  );
  assert.throws(
    () => buildLogQuery({ offset: LOG_OFFSET_MAX + 1 }),
    /VALIDATION/,
  );
  assert.throws(
    () => buildLogQuery({ level: "verbose" as never }),
    /VALIDATION/,
  );
  assert.throws(() => buildLogQuery({ start: "not-a-date" }), /VALIDATION/);
  assert.throws(
    () =>
      buildLogQuery({
        start: new Date(now).toISOString(),
        end: new Date(now - 1000).toISOString(),
      }),
    /VALIDATION/,
  );
});

void test("filter values are escaped as logs string literals", () => {
  const q = buildLogQuery({
    service: "web",
    requestId: 'abc"def\\ghi',
  });
  assert.ok(q.query.includes('service:"web"'));
  assert.ok(q.query.includes('requestId:"abc\\"def\\\\ghi"'));
  // No pipe or unescaped operator smuggled through.
  assert.ok(!/[|]/.test(q.query));
});
