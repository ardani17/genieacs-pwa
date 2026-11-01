import test from "node:test";
import assert from "node:assert/strict";
import { quoteCsvCell } from "../../lib/ui/safe-error.ts";
import { expand } from "../../lib/query.ts";

// stringToRegexp is module-private; expand() drives it for device
// queries, which is the wire path a wildcard takes.

function collect(
  node: unknown,
  pred: (v: unknown) => boolean,
  out: unknown[] = [],
): unknown[] {
  if (pred(node)) out.push(node);
  else if (Array.isArray(node)) for (const n of node) collect(n, pred, out);
  else if (node && typeof node === "object")
    for (const v of Object.values(node)) collect(v, pred, out);
  return out;
}

const regexesOf = (value: string): RegExp[] =>
  collect(expand({ _id: value }), (v) => v instanceof RegExp) as RegExp[];

const stringsOf = (value: string): string[] =>
  collect(expand({ _id: value }), (v) => typeof v === "string") as string[];

void test("CSV escapes every double quote", () => {
  assert.equal(quoteCsvCell('a"b"c'), '"a""b""c"');
});

void test("CSV cells with separators and CRLF stay single cells", () => {
  const row = [
    quoteCsvCell("a,b"),
    quoteCsvCell("line1\r\nline2"),
    quoteCsvCell("=SUM(1)"),
  ].join(",");
  // A conforming reader sees exactly the three quoted cells back.
  const reparsed = row.match(/"(?:[^"]|"")*"/g) ?? [];
  assert.equal(reparsed.length, 3);
  assert.ok(reparsed.includes('"a,b"'));
  assert.ok(reparsed.includes('"line1\r\nline2"'));
});

void test("wildcard literals escape every metacharacter, not just the first", () => {
  // Two-plus metacharacters: the old single replace() left the second
  // one raw, changing (or breaking) the filter's meaning.
  const regexes = regexesOf("a[b].c(d)e+f|g*h");
  assert.ok(regexes.length > 0, "wildcard string became a RegExp");
  for (const re of regexes) {
    assert.ok(
      !re.test("aXbX.cXdXeXfXgXh"),
      "metacharacters must not act as regex operators",
    );
    assert.ok(re.test("a[b].c(d)e+f|gXh"), "literal text still matches");
  }
});

void test("wildcard anchoring and run collapsing are preserved", () => {
  const prefix = regexesOf("abc*");
  assert.ok(prefix.length > 0);
  assert.ok(prefix.every((re) => re.test("abcdef")));
  assert.ok(prefix.every((re) => !re.test("xyzabc")));

  const suffix = regexesOf("*abc");
  assert.ok(suffix.every((re) => re.test("xyzabc")));
  assert.ok(suffix.every((re) => !re.test("abcdef")));

  const infix = regexesOf("a*c");
  assert.ok(infix.every((re) => re.test("abc")));
  assert.ok(infix.every((re) => !re.test("ab")));

  // Runs of wildcards collapse and never produce an invalid pattern
  // (the old code built "a.**b" — an invalid regex — for "a**b").
  const runs = regexesOf("a**b***c");
  assert.ok(runs.length > 0);
  assert.ok(runs.every((re) => re.test("aXbXXc")));

  const onlyStars = regexesOf("**");
  assert.ok(onlyStars.every((re) => re.test("anything")));

  // No wildcard => the literal stays a plain string, no regex.
  const literals = stringsOf("a.b(c)");
  assert.ok(literals.includes("a.b(c)"));
  assert.equal(regexesOf("a.b(c)").length, 0);
});

void test("unicode literals round-trip through the wildcard path", () => {
  const regexes = regexesOf("Ünïcødé-*");
  assert.ok(regexes.length > 0);
  assert.ok(regexes.every((re) => re.test("Ünïcødé-Device")));
  assert.ok(regexes.every((re) => !re.test("unicode-Device")));
});
