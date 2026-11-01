import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchExpression,
  createListQuery,
  toSearchParams,
} from "./query";
import {
  parse,
  stringify,
} from "../../../../../lib/common/expression/parser.ts";

void test("search text becomes a quoted LIKE expression over identity fields", () => {
  const exp = buildSearchExpression('abc"def\\ghi/ü');
  assert.ok(exp);
  // Round-trips through the native parser with punctuation literal.
  const text = stringify(exp);
  const reparsed = parse(text);
  assert.equal(stringify(reparsed), text);
  // No LIKE wildcard injection: three clauses, each with exactly the
  // two surrounding % WE add — nothing extra from the raw text.
  const pct = text.split("%").length - 1;
  assert.equal(pct, 6);
});

void test("createListQuery validates and resets page when the filter changes", () => {
  assert.throws(() => createListQuery({ pageSize: "10" }), /VALIDATION/);
  assert.throws(() => createListQuery({ page: "0" }), /VALIDATION/);
  assert.throws(() => createListQuery({ sort: '{"a":2}' }), /VALIDATION/);
  assert.throws(() => createListQuery({ filter: "_tags = " }), /VALIDATION/);

  const filterText = 'DeviceID.ID LIKE "TEST-%"';
  const first = createListQuery({ page: "3", filter: filterText }, null);
  assert.equal(first.page, 1); // filter changed from null => reset

  const same = createListQuery(
    { page: "3", filter: filterText },
    stringify(first.filter ?? null),
  );
  assert.equal(same.page, 3); // same filter => page preserved

  const valid = createListQuery({});
  assert.equal(valid.page, 1);
  assert.equal(valid.pageSize, 25);
});

void test("URL round-trip preserves page, pageSize, filter and sort", () => {
  const q = createListQuery({
    page: "2",
    pageSize: "50",
    filter: 'DeviceID.ID LIKE "TEST-%"',
    sort: '{"_lastInform":-1}',
  });
  const params = toSearchParams(q);
  const restored = createListQuery(
    Object.fromEntries(params.entries()),
    params.get("filter"),
  );
  assert.equal(restored.page, 2);
  assert.equal(restored.pageSize, 50);
  assert.deepEqual(restored.filter, q.filter);
  assert.equal(restored.sort["_lastInform"], -1);
});
