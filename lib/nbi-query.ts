// Closed-grammar validation for NBI collection queries.
//
// Every query arriving on the North-Bound Interface is checked against a
// strict subset of MongoDB's filter grammar BEFORE it can reach the
// driver: server-side executable operators ($where/$function/...),
// unknown operators and prototype-polluting keys are rejected at every
// depth, and structural limits bound the work a request can request.
// Regexes are constrained to a linear-time subset.

const QUERY_MAX_BYTES = 8192;
const MAX_DEPTH = 10;
const MAX_NODES = 1000;
const FIELD_PATH_MAX = 256;
const LOGICAL_ARRAY_MAX = 100;
const IN_VALUES_MAX = 100;
const SORT_FIELDS_MAX = 8;
const PROJECTION_FIELDS_MAX = 100;
const SKIP_MAX = 1_000_000;
const LIMIT_MAX = 10_000;
export const LIMIT_DEFAULT = 10_000;
export const QUERY_MAX_TIME_MS = 5_000;

export const REGEX_PATTERN_MAX = 256;
export const REGEX_FLAGS_ALLOWED = /^[im]*$/;

const LOGICAL_OPERATORS = new Set(["$and", "$or", "$nor"]);
const FIELD_OPERATORS = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
  "$type",
  "$regex",
  "$options",
  "$not",
  "$elemMatch",
]);
const FORBIDDEN_EXECUTABLE = new Set([
  "$where",
  "$function",
  "$accumulator",
  "$expr",
  "$pipeline",
  "$let",
  "$graphLookup",
  "$lookup",
]);
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class NbiQueryError extends Error {
  code: "VALIDATION";
  exposeStatus: number;
  kind: string;

  constructor(kind: string, message: string, exposeStatus = 400) {
    super(message);
    this.name = "Error";
    this.code = "VALIDATION";
    this.kind = kind;
    this.exposeStatus = exposeStatus;
  }
}

function fail(kind: string, message: string): never {
  throw new NbiQueryError(kind, `VALIDATION ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Linear-time regex subset: no backreferences, no lookaround, no
// quantifier applied to a group that ends in a quantifier, and no
// quantifier applied to any group containing a quantifier or an
// alternation at any depth (the classic ReDoS shapes /(a+)+/,
// /((a+))+/, /((AB)+)+/, /(a|aa){2,}/, /(a|a)+/ — a single flat flag
// loses the inner group's shape when the outer group closes, and
// alternation under repetition is exponentially ambiguous even
// without a trailing quantifier).
export function validateRegexPattern(pattern: string, flags?: string): void {
  if (pattern.length > REGEX_PATTERN_MAX)
    fail("regex_length", `regex pattern exceeds ${REGEX_PATTERN_MAX} chars`);
  if (flags !== undefined && !REGEX_FLAGS_ALLOWED.test(flags))
    fail("regex_flags", `regex flags must be a subset of "im"`);

  if (/\\[1-9]|\\k</.test(pattern))
    fail("regex_feature", "regex backreferences are not allowed");
  if (/\(\?=<?!?|\(\?>|\(\?<[=!]/.test(pattern) || /\(\?[[':]/.test(pattern))
    fail("regex_feature", "regex lookaround/groups extensions are not allowed");

  // Per-depth scan state: each group frame tracks whether its body is
  // "risky" (contains a quantifier, an alternation, or a quantified
  // child group). Quantifying a risky group — or a group ending in a
  // quantified atom — is rejected; risk propagates to the parent when
  // the group closes so nested shapes cannot launder it.
  interface GroupFrame {
    risky: boolean;
    lastAtomQuantified: boolean;
  }
  const groupStack: GroupFrame[] = [];
  const frame = (): GroupFrame | undefined => groupStack[groupStack.length - 1];
  let lastAtomQuantified = false;
  let pendingGroupRisky = false;
  let pendingGroupEndsQuantified = false;
  let escaped = false;
  let inClass = false;
  const isQuantifierChar = (c: string | undefined): boolean =>
    c === "+" || c === "*" || c === "?" || c === "{";
  for (let i = 0; i < pattern.length; ++i) {
    const ch = pattern[i];
    if (escaped) {
      escaped = false;
      lastAtomQuantified = false;
      pendingGroupRisky = false;
      pendingGroupEndsQuantified = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      lastAtomQuantified = false;
      pendingGroupRisky = false;
      pendingGroupEndsQuantified = false;
      continue;
    }
    if (ch === "(") {
      groupStack.push({ risky: false, lastAtomQuantified: false });
      lastAtomQuantified = false;
      pendingGroupRisky = false;
      pendingGroupEndsQuantified = false;
      continue;
    }
    if (ch === ")") {
      const closed = groupStack.pop();
      if (!closed) fail("regex_feature", "unbalanced regex groups");
      if (isQuantifierChar(pattern[i + 1])) {
        // Defer to the quantifier branch, which enforces the rejection;
        // a quantified subexpression will exist in the parent either way.
        pendingGroupRisky = closed.risky;
        pendingGroupEndsQuantified = closed.lastAtomQuantified;
        lastAtomQuantified = false;
        const parent = frame();
        if (parent) parent.risky = true;
        continue;
      }
      // Plain atom in concatenation: only the group's internal risk
      // travels upward (it matters exactly when an ANCESTOR is later
      // quantified).
      if (closed.risky) {
        const parent = frame();
        if (parent) parent.risky = true;
      }
      pendingGroupRisky = false;
      pendingGroupEndsQuantified = false;
      lastAtomQuantified = false;
      continue;
    }
    if (ch === "|") {
      const current = frame();
      if (current) current.risky = true;
      lastAtomQuantified = false;
      pendingGroupRisky = false;
      pendingGroupEndsQuantified = false;
      continue;
    }
    if (isQuantifierChar(ch)) {
      if (lastAtomQuantified || pendingGroupRisky || pendingGroupEndsQuantified)
        fail("regex_feature", "nested quantifiers are not allowed");
      if (ch === "{") {
        const close = pattern.indexOf("}", i);
        if (close === -1) fail("regex_feature", "malformed regex repetition");
        if (!/^\{\d+(,\d*)?\}$/.test(pattern.slice(i, close + 1)))
          fail("regex_feature", "malformed regex repetition");
        i = close;
      }
      const current = frame();
      if (current) current.risky = true;
      lastAtomQuantified = true;
      pendingGroupRisky = false;
      pendingGroupEndsQuantified = false;
      continue;
    }
    lastAtomQuantified = false;
    pendingGroupRisky = false;
    pendingGroupEndsQuantified = false;
  }
  if (groupStack.length) fail("regex_feature", "unbalanced regex groups");
}

interface QueryLimits {
  maxDepth: number;
}

function validateFieldOperatorBody(
  op: string,
  value: unknown,
  limits: QueryLimits,
  depth: number,
): void {
  switch (op) {
    case "$in":
    case "$nin": {
      if (!Array.isArray(value))
        fail("operator_shape", `${op} requires an array`);
      if (value.length > IN_VALUES_MAX)
        fail("operator_limit", `${op} exceeds ${IN_VALUES_MAX} values`);
      for (const v of value) {
        if (isPlainObject(v))
          validateNode(v, limits, depth + 1, { fieldOperator: op });
      }
      return;
    }
    case "$regex":
      // JSON wire input is always a string; a RegExp object can only
      // come from query.expand() re-entering validation with a
      // wildcard/regex-literal it synthesized ("*ABC*" → /ABC/, or
      // "/abc/i" with its flags). Accept those by validating source
      // and flags through the same linear-time check, preserving
      // upstream's documented wildcard device queries.
      if (typeof value === "string") validateRegexPattern(value);
      else if (value instanceof RegExp)
        validateRegexPattern(value.source, [...value.flags].sort().join(""));
      else fail("operator_shape", "$regex requires a string pattern");
      return;
    case "$options":
      if (typeof value !== "string" || !REGEX_FLAGS_ALLOWED.test(value))
        fail("operator_shape", `$options must be a subset of "im"`);
      return;
    case "$exists":
      if (typeof value !== "boolean")
        fail("operator_shape", "$exists requires a boolean");
      return;
    case "$not":
      if (!isPlainObject(value))
        fail("operator_shape", "$not requires an operator object");
      validateNode(value, limits, depth + 1, { fieldOnly: true });
      return;
    case "$elemMatch":
      if (!isPlainObject(value))
        fail("operator_shape", "$elemMatch requires an object");
      validateNode(value, limits, depth + 1, {});
      return;
    case "$type":
      if (
        !(
          typeof value === "string" ||
          (typeof value === "number" && Number.isInteger(value))
        )
      )
        fail("operator_shape", "$type requires a string or number");
      return;
    default:
      return; // comparison operators accept scalar/regular values
  }
}

function validateNode(
  node: Record<string, unknown>,
  limits: QueryLimits,
  depth: number,
  ctx: { fieldOnly?: boolean; fieldOperator?: string },
  budget?: { count: number },
): number {
  const counter = budget ?? { count: 0 };
  if (depth > limits.maxDepth)
    fail("depth", `query nesting exceeds ${limits.maxDepth}`);
  for (const [key, value] of Object.entries(node)) {
    if (PROTOTYPE_KEYS.has(key))
      fail("prototype_key", `field "${key.slice(0, 32)}" is not allowed`);
    counter.count += 1;
    if (counter.count > MAX_NODES)
      fail("node_limit", `query exceeds ${MAX_NODES} nodes`);
    if (key.length > FIELD_PATH_MAX)
      fail("field_length", "field path exceeds 256 characters");

    if (key.startsWith("$")) {
      if (FORBIDDEN_EXECUTABLE.has(key))
        fail("forbidden_operator", `operator ${key} is not allowed`);
      if (LOGICAL_OPERATORS.has(key)) {
        if (ctx.fieldOnly)
          fail("operator_scope", `${key} is not valid in this position`);
        if (!Array.isArray(value) || value.length < 1)
          fail("operator_shape", `${key} requires a non-empty array`);
        if (value.length > LOGICAL_ARRAY_MAX)
          fail("operator_limit", `${key} exceeds ${LOGICAL_ARRAY_MAX} clauses`);
        for (const clause of value) {
          if (!isPlainObject(clause))
            fail("operator_shape", `${key} clauses must be objects`);
          counter.count = validateNode(clause, limits, depth + 1, {}, counter);
        }
        continue;
      }
      if (ctx.fieldOnly && !FIELD_OPERATORS.has(key))
        fail("unknown_operator", `operator ${key} is not allowed here`);
      if (!FIELD_OPERATORS.has(key))
        fail("unknown_operator", `operator ${key} is not allowed`);
      validateFieldOperatorBody(key, value, limits, depth);
      continue;
    }

    // Plain field: value is either an operator object or a literal.
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      const allOperators =
        keys.length > 0 && keys.every((k) => k.startsWith("$"));
      if (allOperators)
        validateNode(value, limits, depth + 1, { fieldOnly: true }, counter);
      else if (keys.length === 0) fail("operator_shape", "empty field object");
      else
        fail(
          "unknown_operator",
          "mixed or non-operator object fields are not allowed",
        );
    } else if (Array.isArray(value)) {
      fail("operator_shape", "bare array field values are not allowed");
    }
  }
  return counter.count;
}

export function validateNbiQuery(
  value: unknown,
  options: { maxDepth?: number; maxBytes?: number } = {},
): Record<string, unknown> {
  const maxBytes = options.maxBytes ?? QUERY_MAX_BYTES;
  if (Buffer.byteLength(JSON.stringify(value ?? null), "utf8") > maxBytes)
    fail("size", `query exceeds ${maxBytes} bytes`);

  if (!isPlainObject(value)) fail("root", "query root must be an object");

  validateNode(value, { maxDepth: options.maxDepth ?? MAX_DEPTH }, 1, {});
  return value;
}

export interface NbiListOptions {
  filter?: Record<string, unknown>;
  projection?: Record<string, number>;
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
}

export function parseNbiListOptions(search: URLSearchParams): NbiListOptions {
  const options: NbiListOptions = {};

  if (search.has("query")) {
    const raw = search.get("query") as string;
    if (Buffer.byteLength(raw, "utf8") > QUERY_MAX_BYTES)
      fail("size", `query exceeds ${QUERY_MAX_BYTES} bytes`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      fail("json", `query is not valid JSON: ${(err as Error).name}`);
    }
    options.filter = validateNbiQuery(parsed);
  }

  if (search.has("projection")) {
    const projection: Record<string, number> = {};
    for (const p of (search.get("projection") as string).split(",")) {
      const field = p.trim();
      if (!field) continue;
      if (PROTOTYPE_KEYS.has(field) || field.length > FIELD_PATH_MAX)
        fail("projection", "invalid projection field");
      projection[field] = 1;
      if (Object.keys(projection).length > PROJECTION_FIELDS_MAX)
        fail(
          "projection",
          `projection exceeds ${PROJECTION_FIELDS_MAX} fields`,
        );
    }
    options.projection = projection;
  }

  if (search.has("sort")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(search.get("sort") as string);
    } catch (err) {
      fail("json", `sort is not valid JSON: ${(err as Error).name}`);
    }
    if (!isPlainObject(parsed)) fail("sort", "sort must be an object");
    const sort: Record<string, 1 | -1> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (PROTOTYPE_KEYS.has(k) || k.length > FIELD_PATH_MAX)
        fail("sort", "invalid sort field");
      if (v !== 1 && v !== -1) fail("sort", "sort direction must be 1 or -1");
      sort[k] = v;
      if (Object.keys(sort).length > SORT_FIELDS_MAX)
        fail("sort", `sort exceeds ${SORT_FIELDS_MAX} fields`);
    }
    options.sort = sort;
  }

  if (search.has("skip")) {
    const skip = Number(search.get("skip"));
    if (!Number.isInteger(skip) || skip < 0 || skip > SKIP_MAX)
      fail("skip", `skip must be an integer between 0 and ${SKIP_MAX}`);
    options.skip = skip;
  }

  if (search.has("limit")) {
    const limit = Number(search.get("limit"));
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX)
      fail("limit", `limit must be an integer between 1 and ${LIMIT_MAX}`);
    options.limit = limit;
  }

  return options;
}
