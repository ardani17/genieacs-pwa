// Parse-only syntax validation for admin-managed scripts (provisions,
// virtual parameters). Replaces the previous vm.Script compilation check:
// compiling an untrusted script is itself the code-execution sink CodeQL
// flags (alerts #9/#10). Parsing never instantiates executable code, and
// the stored script is kept verbatim for the engine sandbox.

import { parse } from "acorn";

export const SCRIPT_MAX_BYTES = 256 * 1024;
export const ID_MAX_CHARS = 256;

const WRAPPER_PREFIX = '"use strict";(function(){\n';
const WRAPPER_SUFFIX = "\n})();";

interface ValidationFailure extends Error {
  code: "VALIDATION";
  exposeStatus: number;
  kind: string;
}

function fail(
  kind: string,
  message: string,
  exposeStatus = 400,
): ValidationFailure {
  const err = new Error(message) as ValidationFailure;
  err.name = "Error";
  err.code = "VALIDATION";
  err.exposeStatus = exposeStatus;
  err.kind = kind;
  return err;
}

export function isValidationFailure(err: unknown): err is ValidationFailure {
  return (
    err instanceof Error &&
    (err as Partial<ValidationFailure>).code === "VALIDATION"
  );
}

// Throws a VALIDATION error (with safe line/column only — never script
// contents or engine stack traces) when the script is not storable.
export function validateAdminScript(script: string, id: string): void {
  if (typeof id !== "string" || !id || id.length > ID_MAX_CHARS) {
    throw fail("id_length", "VALIDATION id length exceeds limit", 413);
  }

  const source = typeof script === "string" ? script : "";
  if (Buffer.byteLength(source, "utf8") > SCRIPT_MAX_BYTES) {
    throw fail(
      "script_size",
      `VALIDATION script size exceeds ${SCRIPT_MAX_BYTES} bytes`,
      413,
    );
  }

  try {
    // Same wrapper the engine sandbox compiles: strict directive plus a
    // function body (top-level `return` is legal, `await` is not).
    parse(WRAPPER_PREFIX + source + WRAPPER_SUFFIX, {
      ecmaVersion: 2022,
      sourceType: "script",
    });
  } catch (err) {
    let line = 1;
    let column = 1;
    if (
      err &&
      typeof err === "object" &&
      "loc" in err &&
      (err as { loc?: { line: number; column: number } }).loc
    ) {
      const loc = (err as { loc: { line: number; column: number } }).loc;
      // The user script starts on wrapper line 2.
      line = Math.max(1, loc.line - 1);
      column = loc.column + 1;
    }
    throw fail(
      "script_syntax",
      `VALIDATION ${err instanceof Error ? err.name : "SyntaxError"} at line ${line} column ${column}`,
    );
  }
}
