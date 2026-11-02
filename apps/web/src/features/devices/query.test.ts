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
import { evaluate } from "../../../../../lib/common/expression/util.ts";

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

void test("search BEHAVIOR: quotes, backslashes and wildcards match literally (RE-SPEC-07)", () => {
  const devices = {
    // exact-literal needles and the decoys they must NOT match
    quote: { "DeviceID.ID": 'a"b' },
    quoteDecoy: { "DeviceID.ID": "ab" },
    backslash: { "DeviceID.ID": "a\\b" },
    backslashDecoy: { "DeviceID.ID": "ab" },
    percent: { "DeviceID.ID": "50%" },
    // The reviewer's proof case: a bare "%" search used to match this.
    unrelated: { "DeviceID.ID": "UNRELATED" },
    underscore: { "DeviceID.ID": "a_b" },
    underscoreDecoy: { "DeviceID.ID": "axb" },
    unicode: { "DeviceID.ID": "ZüTE" },
  };
  const matches = (needle: string, dev: Record<string, unknown>): boolean =>
    evaluate(buildSearchExpression(needle), dev, Date.now()) === true;

  assert.equal(matches('a"b', devices.quote), true);
  assert.equal(matches('a"b', devices.quoteDecoy), false);
  assert.equal(matches("a\\b", devices.backslash), true);
  assert.equal(matches("a\\b", devices.backslashDecoy), false);
  // A bare % searches for a LITERAL percent sign, not everything.
  assert.equal(matches("%", devices.percent), true);
  assert.equal(matches("%", devices.unrelated), false);
  assert.equal(matches("50%", devices.percent), true);
  assert.equal(matches("_", devices.underscore), true);
  assert.equal(matches("_", devices.underscoreDecoy), false);
  assert.equal(matches("ü", devices.unicode), true);
  // Current contract: LIKE without UPPER/LOWER is case-sensitive —
  // pinned here so a semantic change is a deliberate decision.
  assert.equal(matches("züte", devices.unicode), false);
  // The serialized form stays parseable and equivalent end to end.
  // (LIKE over a missing param yields SQL-null, not false — the helper
  // normalizes to a plain boolean.)
  const serialized = stringify(buildSearchExpression('a"b'));
  assert.equal(matches('a"b', devices.quote), true);
  assert.equal(evaluate(parse(serialized), devices.quote, Date.now()), true);
  assert.notEqual(
    evaluate(parse(serialized), devices.quoteDecoy, Date.now()),
    true,
  );
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
