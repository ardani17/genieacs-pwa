import test from "node:test";
import assert from "node:assert/strict";
import {
  likePatternToRegExp,
  evaluate,
} from "../../lib/common/expression/util.ts";
import { parse } from "../../lib/common/expression/parser.ts";
import { toMongoQuery } from "../../lib/db/synth.ts";

void test("LIKE metacharacters and backslashes remain literal", () => {
  assert.equal(likePatternToRegExp("a.b").test("axb"), false);
  assert.equal(likePatternToRegExp("a.b").test("a.b"), true);
  // Two literal backslashes (esc is empty by default) must NOT become a
  // slash — the old conversion table mapped "\\" to "/".
  assert.equal(likePatternToRegExp("a\\\\b").test("a/b"), false);
  assert.equal(likePatternToRegExp("a\\\\b").test("a\\\\b"), true);
  assert.equal(likePatternToRegExp("a\\\\b").test("a\\b"), false);
});

void test("wildcards keep SQL meaning and anchoring", () => {
  const any = likePatternToRegExp("%abc%");
  assert.ok(any.test("xxxabcyyy"));
  assert.ok(!any.test("abC"));

  const prefix = likePatternToRegExp("abc%");
  assert.ok(prefix.test("abcdef"));
  assert.ok(!prefix.test("xabc"));

  const suffix = likePatternToRegExp("%abc");
  assert.ok(suffix.test("xyzabc"));
  assert.ok(!suffix.test("abcz"));

  const single = likePatternToRegExp("a_c");
  assert.ok(single.test("abc"));
  assert.ok(single.test("axc"));
  assert.ok(!single.test("ac"));
  assert.ok(!single.test("abbc"));

  // Consecutive % collapse and stay equivalent.
  assert.deepEqual(
    likePatternToRegExp("a%%b").test("axxb"),
    likePatternToRegExp("a%b").test("axxb"),
  );
  // Escaped wildcards are literal.
  assert.ok(likePatternToRegExp("50\\%", "\\").test("50%"));
  assert.ok(!likePatternToRegExp("50\\%", "\\").test("50x"));
  assert.ok(likePatternToRegExp("a\\_b", "\\").test("a_b"));
  assert.ok(!likePatternToRegExp("a\\_b", "\\").test("axb"));
});

void test("regex injection through LIKE patterns is impossible", () => {
  // Without wildcards a pattern matches exactly its own literal text.
  for (const pat of [
    "a|b",
    "a+b",
    "(a)",
    "[abc]",
    "a{2}",
    "^a",
    "a$",
    "a.*b",
    "a\\db",
    "\\n",
  ]) {
    const re = likePatternToRegExp(pat);
    assert.ok(re.test(pat), `literal self-match for ${pat}`);
  }
  const alt = likePatternToRegExp("a|b");
  assert.ok(!alt.test("a"));
  assert.ok(!alt.test("b"));
  assert.ok(alt.test("a|b"));
  assert.ok(!likePatternToRegExp("(x)+").test("xxxx"));
  assert.ok(likePatternToRegExp("(x)+").test("(x)+"));
});

void test("pattern budgets and flags fail with controlled errors", () => {
  assert.throws(
    () => likePatternToRegExp("a".repeat(5000)),
    /VALIDATION LIKE pattern exceeds/,
  );
  assert.throws(
    () => likePatternToRegExp("%".repeat(33)),
    /VALIDATION LIKE pattern exceeds/,
  );
  assert.throws(
    () => likePatternToRegExp("a", "", "g"),
    /VALIDATION LIKE flags/,
  );
  assert.throws(() => likePatternToRegExp("a\\", "\\"), /dangling escape/);
  // Allowed flags work.
  assert.equal(likePatternToRegExp("abc", "", "i").test("ABC"), true);
  assert.equal(likePatternToRegExp("abc", "", "m").source, "^abc$");
});

void test("evaluate LIKE / NOT LIKE agrees with the tokenizer", () => {
  const ev = (expr: string, params: Record<string, unknown>): unknown =>
    evaluate(parse(expr), (name: string) => params[name] as never, Date.now());

  assert.equal(
    ev('SerialNumber LIKE "ABC%"', { SerialNumber: "ABC123" }),
    true,
  );
  assert.equal(ev('SerialNumber LIKE "ABC%"', { SerialNumber: "XABC" }), false);
  assert.equal(
    ev('SerialNumber NOT LIKE "ABC%"', { SerialNumber: "XABC" }),
    true,
  );
  assert.equal(ev('Version LIKE "1_2"', { Version: "1x2" }), true);
  assert.equal(ev('Version LIKE "1\\.2"', { Version: "1.2" }), true);
  assert.equal(ev('Version LIKE "1\\.2"', { Version: "1x2" }), false);
  assert.equal(ev('Name LIKE "%héllo%"', { Name: "xhéllox" }), true);
});

void test("mongo synthesis consumes the same tokens safely", () => {
  const show = (q: unknown): string =>
    JSON.stringify(q, (_k, v) =>
      v instanceof RegExp ? "REGEX:" + v.source : v,
    );

  // Wildcards synthesize to the anchored wildcard pattern...
  assert.equal(
    show(toMongoQuery(parse('DeviceID.ID LIKE "A%B"'), "devices")),
    '{"_id":{"pattern":"^A.*B$","options":"s"}}',
  );
  // ...while regex metacharacters in the literal arrive fully escaped —
  // no alternation or quantifier injection through the LIKE grammar.
  assert.equal(
    show(toMongoQuery(parse('DeviceID.ID LIKE "a.b|c"'), "devices")),
    '{"_id":{"pattern":"^a\\\\.b\\\\|c$","options":"s"}}',
  );
});
