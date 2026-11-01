import test from "node:test";
import assert from "node:assert/strict";
import {
  readQuotedJsString,
  StringScanError,
  lastScanVisitedChars,
} from "../../lib/common/expression/parser.ts";
import { parse } from "../../lib/common/expression/parser.ts";

void test("scanner accepts well-formed strings and keeps escapes raw", () => {
  assert.deepEqual(readQuotedJsString('"abc"', 0), { raw: "abc", end: 5 });
  assert.deepEqual(readQuotedJsString('"a\\"b"', 0), { raw: 'a\\"b', end: 6 });
  assert.deepEqual(readQuotedJsString('""', 0), { raw: "", end: 2 });
  assert.deepEqual(readQuotedJsString('"\\u0041"', 0), {
    raw: "\\u0041",
    end: 8,
  });
  // start index is honored (parsimmon feeds mid-input positions); end is
  // one past the closing quote.
  assert.deepEqual(readQuotedJsString('x = "ab"', 4), { raw: "ab", end: 8 });
});

void test("scanner rejects malformed strings with an index", () => {
  for (const [input, at] of [
    ['"abc', 0],
    ['"abc\\', 0],
    ['"a\nb"', 0],
    ['"a\rb"', 0],
    ['"a\\\n"', 0],
  ] as [string, number][]) {
    assert.throws(
      () => readQuotedJsString(input, at),
      (err) => err instanceof StringScanError && err.index >= 0,
      `expected failure for ${JSON.stringify(input)}`,
    );
  }
  assert.throws(
    () => readQuotedJsString("abc", 0),
    (err) => err instanceof StringScanError,
  );
});

void test("scanner is single pass: visitedChars <= input length + 1", () => {
  // Adversarial near-miss strings that maximized backtracking in the old
  // regexp — including nested-escape runs and many almost-closing quotes.
  for (const input of [
    '"' + "a\\".repeat(4096),
    '"' + "a".repeat(4096),
    '"' + "\\\\a".repeat(2048),
    '"' + "\\a".repeat(4096) + "x",
  ]) {
    assert.throws(() => readQuotedJsString(input, 0), Error);
    assert.ok(
      lastScanVisitedChars <= input.length + 1,
      `visited ${lastScanVisitedChars} of ${input.length}`,
    );
  }
  const ok = '"' + "ab\\".repeat(1000) + 'c"';
  readQuotedJsString(ok, 0);
  assert.ok(lastScanVisitedChars <= ok.length + 1);
});

void test("parser behavior parity for valid strings", () => {
  assert.deepEqual(parse('"hello"'), "hello");
  assert.deepEqual(parse('"a\\nb"'), "a\nb");
  assert.deepEqual(parse('"\\u0041"'), "A");
  assert.deepEqual(parse("'SQL'"), "SQL");
  assert.deepEqual(parse("'O''Brien'"), "O'Brien");
  assert.deepEqual(parse('"a\\"b"'), 'a"b');
});

void test("parser rejects unterminated and newline-bearing strings", () => {
  assert.throws(() => parse('"abc'));
  assert.throws(() => parse('"a\nb"'));
  assert.throws(() => parse('"abc\\'));
});

void test("bounded malformed input is rejected, not executed", () => {
  // 8/16/32 KiB near-miss strings must fail parsing deterministically;
  // the node:test per-test timeout (runner) bounds wall time.
  for (const size of [8, 16, 32]) {
    const input = '"' + "a\\".repeat((size * 1024) / 2);
    assert.throws(() => parse(input));
    assert.ok(lastScanVisitedChars <= input.length + 1);
  }
});
