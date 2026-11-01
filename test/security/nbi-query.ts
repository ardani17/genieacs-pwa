import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNbiQuery,
  parseNbiListOptions,
  validateRegexPattern,
  NbiQueryError,
} from "../../lib/nbi-query.ts";

const isKind = (err: unknown, kind: string): boolean =>
  err instanceof NbiQueryError && err.kind === kind;

void test("server-side executable operators never reach Mongo", () => {
  assert.throws(
    () => validateNbiQuery({ $where: "return true" }),
    (err) => isKind(err, "forbidden_operator"),
  );
  assert.throws(
    () => validateNbiQuery({ x: { $function: { body: "return true" } } }),
    (err) => isKind(err, "forbidden_operator"),
  );
  assert.throws(
    () => validateNbiQuery({ $expr: { $gt: [1, 2] } }),
    (err) => isKind(err, "forbidden_operator"),
  );
  assert.deepEqual(validateNbiQuery({ SerialNumber: { $eq: "TEST-001" } }), {
    SerialNumber: { $eq: "TEST-001" },
  });
});

void test("root must be a plain object", () => {
  for (const bad of [[1, 2], null, "x", 5, [{ $and: [] }]])
    assert.throws(
      () => validateNbiQuery(bad),
      (err) => isKind(err, "root"),
    );
});

void test("prototype keys are rejected at every depth", () => {
  // An object literal with a "__proto__" key sets the prototype instead of
  // an own property, so the hostile shape comes from JSON.parse — exactly
  // how it would arrive over the wire.
  assert.throws(
    () => validateNbiQuery(JSON.parse('{"__proto__": {"polluted": true}}')),
    (err) => isKind(err, "prototype_key"),
  );
  assert.throws(
    () => validateNbiQuery({ a: { $elemMatch: { constructor: 1 } } }),
    (err) => isKind(err, "prototype_key"),
  );
  assert.throws(
    () => validateNbiQuery({ $or: [{ "x.y": { $not: { prototype: 1 } } }] }),
    (err) => isKind(err, "prototype_key"),
  );
});

void test("unknown and misplaced operators are rejected", () => {
  assert.throws(
    () => validateNbiQuery({ x: { $neWhere: 1 } }),
    (err) => isKind(err, "unknown_operator"),
  );
  assert.throws(
    () => validateNbiQuery({ $and: [{ x: { $and2: 1 } }] }),
    (err) => isKind(err, "unknown_operator"),
  );
  // Logical operators are root-level only.
  assert.throws(
    () => validateNbiQuery({ x: { $or: [1] } }),
    (err) => isKind(err, "unknown_operator") || isKind(err, "operator_scope"),
  );
});

void test("structural limits are enforced", () => {
  // Depth.
  let deep: Record<string, unknown> = { $and: [{ a: { $eq: 1 } }] };
  for (let i = 0; i < 12; ++i) deep = { $and: [deep] };
  assert.throws(
    () => validateNbiQuery(deep),
    (err) => isKind(err, "depth"),
  );

  // Logical array cap.
  const clauses = Array.from({ length: 101 }, () => ({ a: { $eq: 1 } }));
  assert.throws(
    () => validateNbiQuery({ $or: clauses }),
    (err) => isKind(err, "operator_limit"),
  );

  // $in cap.
  assert.throws(
    () =>
      validateNbiQuery({
        s: { $in: Array.from({ length: 101 }, (_, i) => i) },
      }),
    (err) => isKind(err, "operator_limit"),
  );

  // Field path length.
  assert.throws(
    () => validateNbiQuery({ [`${"a".repeat(300)}.b`]: { $eq: 1 } }),
    (err) => isKind(err, "field_length"),
  );

  // Byte size.
  assert.throws(
    () => validateNbiQuery({ s: { $eq: "x".repeat(9000) } }),
    (err) => isKind(err, "size"),
  );
});

void test("regex subset rejects superlinear patterns and features", () => {
  for (const bad of [
    "(a+)+",
    "(a*)*",
    "(a+){2,}",
    "(?:a+?)+",
    "\\1(b)",
    "(?=x)",
    "(?<=x)y",
    "x(?<!y)",
  ]) {
    assert.throws(
      () => validateRegexPattern(bad),
      (err) => isKind(err, "regex_feature"),
      `expected rejection for ${bad}`,
    );
  }
  for (const ok of [
    "^Device\\.",
    "^[A-Za-z0-9_-]+$",
    "FW\\.[0-9]+\\.[0-9]+",
    "(AB)+",
    "a{1,4}",
  ]) {
    validateRegexPattern(ok);
  }
  assert.throws(
    () => validateRegexPattern("a".repeat(300)),
    (err) => isKind(err, "regex_length"),
  );
  assert.throws(
    () => validateRegexPattern("a", "g"),
    (err) => isKind(err, "regex_flags"),
  );
});

void test("parseNbiListOptions validates sort, skip and limit", () => {
  const ok = parseNbiListOptions(
    new URLSearchParams(
      "?query=" +
        encodeURIComponent('{"a":{"$gt":1}}') +
        "&sort=" +
        encodeURIComponent('{"a":-1}') +
        "&skip=10&limit=100",
    ),
  );
  assert.deepEqual(ok.sort, { a: -1 });
  assert.equal(ok.skip, 10);
  assert.equal(ok.limit, 100);

  assert.throws(
    () =>
      parseNbiListOptions(
        new URLSearchParams("?sort=" + encodeURIComponent('{"a":2}')),
      ),
    (err) => isKind(err, "sort"),
  );
  assert.throws(
    () =>
      parseNbiListOptions(
        new URLSearchParams(
          "?sort=" +
            encodeURIComponent(
              JSON.stringify(
                Object.fromEntries(
                  Array.from({ length: 9 }, (_, i) => [`f${i}`, 1]),
                ),
              ),
            ),
        ),
      ),
    (err) => isKind(err, "sort"),
  );
  assert.throws(
    () => parseNbiListOptions(new URLSearchParams("?skip=-1")),
    (err) => isKind(err, "skip"),
  );
  assert.throws(
    () => parseNbiListOptions(new URLSearchParams("?skip=abc")),
    (err) => isKind(err, "skip"),
  );
  assert.throws(
    () => parseNbiListOptions(new URLSearchParams("?limit=0")),
    (err) => isKind(err, "limit"),
  );
  assert.throws(
    () => parseNbiListOptions(new URLSearchParams("?limit=10001")),
    (err) => isKind(err, "limit"),
  );
  assert.throws(
    () =>
      parseNbiListOptions(
        new URLSearchParams(
          "?projection=" +
            Array.from({ length: 101 }, (_, i) => `f${i}`).join(","),
        ),
      ),
    (err) => isKind(err, "projection"),
  );
});

void test("valid device/task/fault style queries pass through unchanged", () => {
  assert.deepEqual(
    validateNbiQuery({
      $and: [
        { _lastInform: { $gte: "2026-01-01T00:00:00.000Z" } },
        { "DeviceID.SerialNumber": { $in: ["S1", "S2"] } },
        { _tags: "online" },
      ],
    }),
    {
      $and: [
        { _lastInform: { $gte: "2026-01-01T00:00:00.000Z" } },
        { "DeviceID.SerialNumber": { $in: ["S1", "S2"] } },
        { _tags: "online" },
      ],
    },
  );
  assert.deepEqual(
    validateNbiQuery({ channel: { $regex: "^default$", $options: "i" } }),
    { channel: { $regex: "^default$", $options: "i" } },
  );
  assert.deepEqual(validateNbiQuery({}), {});
});
