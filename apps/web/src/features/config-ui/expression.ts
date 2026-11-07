"use client";

// Config UI expression evaluation: the NATIVE pure parser/evaluator
// (no eval, no new Function, no raw HTML), with device parameters
// resolved against the caller's authorized flat device and a
// deterministic `now`.
import { evaluate } from "../../../../../lib/common/expression/util.ts";
import { parse } from "../../../../../lib/common/expression/parser.ts";
import type { Expression } from "../../../../../lib/types.ts";
import type { FlatDeviceLike } from "../../../../../packages/device-profiles/src/types.ts";

export type UiExpression = string | Expression;

// Resolve PARAM leaves from the flat device; anything else passes
// through the native evaluator untouched.
function deviceCallback(device: FlatDeviceLike): (e: Expression) => unknown {
  return (e) => {
    if (!Array.isArray(e)) return e;
    if (e[0] === "PARAM" && typeof e[1] === "string") {
      const entry = device[e[1]] as { value?: [unknown, string] } | undefined;
      if (entry?.value) return entry.value[0];
      return null;
    }
    return e;
  };
}

export function evaluateUiExpression(
  expression: UiExpression | undefined,
  device: FlatDeviceLike,
  now: number,
): unknown {
  if (expression == null) return null;
  try {
    const exp =
      typeof expression === "string"
        ? (parse(expression) as Expression)
        : expression;
    return evaluate(exp, device as never, now, deviceCallback(device) as never);
  } catch {
    // A malformed expression renders as null — never an exception that
    // could take down the whole config tree.
    return null;
  }
}

export function evaluateToText(
  expression: UiExpression | undefined,
  device: FlatDeviceLike,
  now: number,
): string {
  const v = evaluateUiExpression(expression, device, now);
  if (v == null) return "Belum tersedia";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
