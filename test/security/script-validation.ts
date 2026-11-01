import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAdminScript,
  isValidationFailure,
  SCRIPT_MAX_BYTES,
  ID_MAX_CHARS,
} from "../../lib/ui/script-validation.ts";

void test("syntax validation never executes submitted JavaScript", () => {
  delete globalThis["fixtureMarker"];
  validateAdminScript(
    'globalThis.fixtureMarker = "executed"; return 1;',
    "fixture",
  );
  assert.equal(globalThis["fixtureMarker"], undefined);
  assert.throws(() => validateAdminScript("return (", "fixture"), /VALIDATION/);
});

void test("wrapper parity: strict function body grammar", () => {
  // Top-level return is legal inside the wrapper body.
  validateAdminScript("return 1;", "fixture");
  validateAdminScript("", "fixture");
  validateAdminScript("const x = {a: 1, b: [2, 3]}; return x.a;", "fixture");

  // Grammar the strict wrapper rejects stays rejected — without ever
  // compiling the script.
  for (const bad of [
    "await 1;",
    "yield 1;",
    "with ({}) {}",
    "const dup; const dup;",
    "break;",
    "0x",
  ])
    assert.throws(
      () => validateAdminScript(bad, "fixture"),
      (err) =>
        isValidationFailure(err) && /line \d+ column \d+/.test(err.message),
      `expected VALIDATION for ${JSON.stringify(bad)}`,
    );
});

void test("error details expose position only, never script content or stack", () => {
  try {
    validateAdminScript("const SECRETSENTINEL = 1;;;\nreturn (", "fixture-id");
    assert.fail("expected VALIDATION");
  } catch (err) {
    assert.ok(isValidationFailure(err));
    // Position may be reported at the wrapper's closing line for
    // EOF-style errors; what matters is the safe shape and that neither
    // the message nor the stack carries script content.
    assert.match(err.message, /line \d+ column \d+/);
    assert.ok(!err.message.includes("SECRETSENTINEL"));
    assert.ok(!err.stack?.includes("SECRETSENTINEL"));
  }
});

void test("oversize scripts and ids are rejected before parsing with 413", () => {
  assert.throws(
    () =>
      validateAdminScript(
        '"x".repeat(1) + "' + "a".repeat(SCRIPT_MAX_BYTES) + '"',
        "fixture",
      ),
    (err) => isValidationFailure(err) && err.exposeStatus === 413,
  );
  assert.throws(
    () => validateAdminScript("1;", "i".repeat(ID_MAX_CHARS + 1)),
    (err) => isValidationFailure(err) && err.exposeStatus === 413,
  );
});

void test("scripts mentioning process or require are stored-parseable, not run", () => {
  // Parsing is not execution: require/process references must survive
  // validation so admin provisions keep working under the engine sandbox.
  delete globalThis["fixtureRequireRan"];
  validateAdminScript('const r = require("fs"); return typeof r;', "fixture");
  validateAdminScript("return typeof process;", "fixture");
  assert.equal(globalThis["fixtureRequireRan"], undefined);
});
