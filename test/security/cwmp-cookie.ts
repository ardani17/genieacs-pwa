import test from "node:test";
import assert from "node:assert/strict";
import {
  getCwmpSessionId,
  CwmpCookieError,
  CWMP_COOKIE_HEADER_MAX_BYTES,
} from "../../lib/cwmp-cookie.ts";

void test("CPE comma cookies and quoted session remain compatible", () => {
  assert.equal(getCwmpSessionId('other=x, session="TEST-1"; foo=y'), "TEST-1");
  assert.equal(getCwmpSessionId(undefined), undefined);
});

void test("baseline compatibility corpus", () => {
  assert.equal(getCwmpSessionId("session=TEST-1"), "TEST-1");
  assert.equal(getCwmpSessionId('session="TEST-1"'), "TEST-1");
  assert.equal(getCwmpSessionId("foo=bar; session=TEST-2"), "TEST-2");
  assert.equal(getCwmpSessionId("foo=bar, session=TEST-3"), "TEST-3");
  // Last valid session wins.
  assert.equal(getCwmpSessionId("session=A; other=x; session=B"), "B");
  // Empty value follows the baseline (empty string, not undefined).
  assert.equal(getCwmpSessionId("session="), "");
  assert.equal(getCwmpSessionId('session=""'), "");
  // Whitespace tolerance.
  assert.equal(getCwmpSessionId("  session = TEST-4  ; x = y "), "TEST-4");
  // Invalid tokens are ignored, valid ones still parse.
  assert.equal(getCwmpSessionId("!!!; session=TEST-5"), "TEST-5");
  assert.equal(getCwmpSessionId("session==TEST-6"), undefined);
  assert.equal(getCwmpSessionId("session"), undefined);
  assert.equal(getCwmpSessionId('session="unterminated'), undefined);
  assert.equal(getCwmpSessionId("session=ok junk; session=TEST-7"), "TEST-7");
  assert.equal(getCwmpSessionId(""), undefined);
  // Allowed value charset only.
  assert.equal(getCwmpSessionId("session=a-b_C9"), "a-b_C9");
  assert.equal(getCwmpSessionId("session=OK;evil<"), "OK");
});

void test("oversized headers are rejected with a 431-mapped error", () => {
  assert.throws(
    () =>
      getCwmpSessionId("session=" + "a".repeat(CWMP_COOKIE_HEADER_MAX_BYTES)),
    (err) => err instanceof CwmpCookieError && err.exposeStatus === 431,
  );
  const ok = "session=" + "a".repeat(CWMP_COOKIE_HEADER_MAX_BYTES - 9);
  assert.equal(
    getCwmpSessionId(ok),
    "a".repeat(CWMP_COOKIE_HEADER_MAX_BYTES - 9),
  );
});

void test("bounded adversarial inputs complete in a single pass", () => {
  // The shapes that maximized backtracking in the old lazy-quantifier
  // regex: long token runs, quote cascades, near-miss delimiters.
  const oversized = [
    "a".repeat(32 * 1024),
    'session="' + "a".repeat(32 * 1024),
    "session=aaaaaaaaaaaa;".repeat(1024) + "session=LAST",
  ];
  for (const input of oversized)
    assert.throws(
      () => getCwmpSessionId(input),
      (err) => err instanceof CwmpCookieError,
    );

  // Same shapes, under the cap, must parse in one pass.
  const inCap = [
    "a".repeat(8192),
    'session="' + "a".repeat(4096),
    "session=aaaaaaaaaaaa;".repeat(300) + "session=LAST",
    ";,;,".repeat(1024) + "session=TAIL",
    " = ".repeat(1024) + "session=X",
  ];
  for (const input of inCap) getCwmpSessionId(input);
  assert.equal(getCwmpSessionId(inCap[2]), "LAST");
  assert.equal(getCwmpSessionId(inCap[3]), "TAIL");
  assert.equal(getCwmpSessionId(inCap[4]), "X");
});
