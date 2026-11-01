import parsimmon from "parsimmon";
import { Expression } from "../../types.ts";

// Turn escaped characters into real ones (e.g. "\\n" becomes "\n").
// Linear single-pass scanner for JS-style double-quoted strings. The old
// parsimmon regexp /"((?:\\.|.)*?)"/ backtracked over adversarial input
// (CodeQL #15); this walker consumes each character exactly once. Escapes
// are preserved verbatim in `raw` (interpretEscapes runs afterwards, as
// before). A literal newline, a trailing escape or EOF before the closing
// quote fails with the offending index.
export class StringScanError extends Error {
  index: number;

  constructor(index: number, message: string) {
    super(message);
    this.name = "StringScanError";
    this.index = index;
  }
}

// Number of characters visited by the last readQuotedJsString call —
// exposed for the linearity assertion (<= input length + 1).
export let lastScanVisitedChars = 0;

export function readQuotedJsString(
  text: string,
  start: number,
): { raw: string; end: number } {
  if (text[start] !== '"')
    throw new StringScanError(start, "not at a string start");

  let raw = "";
  let i = start + 1;
  const begin = start;
  while (i < text.length) {
    lastScanVisitedChars = i - begin + 1;
    const c = text[i];
    if (c === "\\") {
      const next = text[i + 1];
      if (next === undefined)
        throw new StringScanError(i, "unterminated string escape");
      if (next === "\n" || next === "\r")
        throw new StringScanError(i, "literal newline in string escape");
      raw += c + next;
      i += 2;
      continue;
    }
    if (c === '"') return { raw, end: i + 1 };
    if (c === "\n" || c === "\r")
      throw new StringScanError(i, "literal newline in string");
    raw += c;
    i += 1;
  }
  throw new StringScanError(start, "unterminated string");
}

function interpretEscapes(str: string): string {
  const escapes: Record<string, string> = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
  };
  return str.replace(/\\(u[0-9a-fA-F]{4}|[^u])/g, (_, escape: string) => {
    const type = escape.charAt(0);
    const hex = escape.slice(1);
    if (type === "u") return String.fromCharCode(parseInt(hex, 16));

    if (Object.hasOwn(escapes, type)) return escapes[type];

    return type;
  });
}

export function map<T>(exp: Expression, callback: (e: Expression) => T): T {
  if (!Array.isArray(exp)) return callback(exp);

  let clone;
  for (let i = 1; i < exp.length; ++i) {
    const sub = map(exp[i], callback);
    if (sub !== exp[i]) {
      clone = clone || exp.slice();
      clone[i] = sub;
    }
  }

  return callback(clone || exp);
}

export async function mapAsync(
  exp: Expression,
  callback: (e: Expression) => Promise<Expression>,
): Promise<Expression> {
  if (!Array.isArray(exp)) return callback(exp);

  let clone;
  for (let i = 1; i < exp.length; ++i) {
    const sub = await mapAsync(exp[i], callback);
    if (sub !== exp[i]) {
      clone = clone || exp.slice();
      clone[i] = sub;
    }
  }

  return callback(clone || exp);
}

function binaryLeft(
  operatorsParser: parsimmon.Parser<string>,
  nextParser: parsimmon.Parser<Expression>,
): parsimmon.Parser<Expression> {
  return parsimmon.seqMap(
    nextParser,
    parsimmon.seq(operatorsParser, nextParser).many(),
    (first, rest) =>
      rest.reduce((acc, ch) => {
        const [op, another] = ch;
        if (Array.isArray(acc) && op === acc[0]) return acc.concat([another]);
        return [op, acc, another];
      }, first),
  );
}

const lang = parsimmon.createLanguage({
  ComparisonOperator: function () {
    return parsimmon
      .alt(
        parsimmon.string(">="),
        parsimmon.string("<>"),
        parsimmon.string("<="),
        parsimmon.string("="),
        parsimmon.string(">"),
        parsimmon.string("<"),
      )
      .skip(parsimmon.optWhitespace);
  },
  LikeOperator: function () {
    return parsimmon
      .alt(
        parsimmon.regexp(/like/i).result("LIKE").desc("LIKE"),
        parsimmon
          .regexp(/not\s+like/i)
          .result("NOT LIKE")
          .desc("NOT LIKE"),
      )
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace);
  },
  IsNullOperator: function () {
    return parsimmon
      .alt(
        parsimmon
          .regexp(/is\s+null/i)
          .result("IS NULL")
          .desc("IS NULL"),
        parsimmon
          .regexp(/is\s+not\s+null/i)
          .result("IS NOT NULL")
          .desc("IS NOT NULL"),
      )
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace);
  },
  NotOperator: function () {
    return parsimmon
      .regexp(/not/i)
      .result("NOT")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("NOT");
  },
  AndOperator: function () {
    return parsimmon
      .regexp(/and/i)
      .result("AND")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("AND");
  },
  OrOperator: function () {
    return parsimmon
      .regexp(/or/i)
      .result("OR")
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .desc("OR");
  },
  Parameter: function (r) {
    return parsimmon
      .alt(
        parsimmon.regexp(/[a-zA-Z0-9_.*-]+/),
        r.Expression.wrap(
          parsimmon.string("{").skip(parsimmon.optWhitespace),
          parsimmon.string("}"),
        ),
      )
      .atLeast(1)
      .map((x) => ["PARAM", x.length > 1 ? ["||"].concat(x) : x[0]])
      .skip(parsimmon.optWhitespace)
      .desc("parameter");
  },
  StringValueSql: function () {
    return parsimmon
      .regexp(/'([^']*)'/, 1)
      .atLeast(1)
      .skip(parsimmon.optWhitespace)
      .map((s) => s.join("'"))
      .desc("string");
  },
  StringValueJs: function () {
    return parsimmon((input: string, i: number) => {
      if (input[i] !== '"') return parsimmon.makeFailure(i, "string");
      try {
        const { raw, end } = readQuotedJsString(input, i);
        return parsimmon.makeSuccess(end, raw);
      } catch (err) {
        return parsimmon.makeFailure(
          err instanceof StringScanError ? err.index : i,
          "string",
        );
      }
    })
      .skip(parsimmon.optWhitespace)
      .map(interpretEscapes)
      .desc("string");
  },
  NumberValue: function () {
    return parsimmon
      .regexp(/-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?/)
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .map(Number)
      .desc("number");
  },
  BooleanValue: function () {
    return parsimmon
      .alt(
        parsimmon.regexp(/true/i).result(true).desc("TRUE"),
        parsimmon.regexp(/false/i).result(false).desc("FALSE"),
      )
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace);
  },
  NullValue: function () {
    return parsimmon
      .regexp(/null/i)
      .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
      .skip(parsimmon.optWhitespace)
      .result(null)
      .desc("NULL");
  },
  FuncValue: function (r) {
    return parsimmon.seqMap(
      parsimmon
        .regexp(/([a-zA-Z0-9_]+)/, 1)
        .skip(parsimmon.optWhitespace)
        .desc("function"),
      r.ExpressionList.wrap(
        parsimmon.string("(").skip(parsimmon.optWhitespace),
        parsimmon.string(")").skip(parsimmon.optWhitespace),
      ),
      (f, args) => ["FUNC", f.toUpperCase()].concat(args),
    );
  },
  WhenPair: function (r) {
    return parsimmon.seq(
      parsimmon
        .regexp(/when/i)
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("WHEN")
        .then(r.Expression),
      parsimmon
        .regexp(/then/i)
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("THEN")
        .then(r.Expression),
    );
  },
  CaseStatement: function (r) {
    return parsimmon.seqMap(
      parsimmon
        .regexp(/case/i)
        .result("CASE")
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("CASE"),
      r.WhenPair.many(),
      parsimmon
        .regexp(/else/i)
        .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/))
        .skip(parsimmon.optWhitespace)
        .desc("ELSE")
        .then(r.Expression)
        .map((e) => [[true, e]])
        .fallback(null)
        .skip(
          parsimmon
            .regex(/end/i)
            .notFollowedBy(parsimmon.regexp(/[a-zA-Z0-9_]/)),
        )
        .skip(parsimmon.optWhitespace),
      (...arr) => arr.flat(2),
    );
  },
  Value: function (r) {
    return parsimmon.alt(
      r.NullValue,
      r.BooleanValue,
      r.NumberValue,
      r.StringValueSql,
      r.StringValueJs,
      r.FuncValue,
      r.CaseStatement,
    );
  },
  ValueExpression: function (r) {
    return binaryLeft(
      parsimmon.string("||").skip(parsimmon.optWhitespace),
      binaryLeft(
        parsimmon
          .alt(parsimmon.string("+"), parsimmon.string("-"))
          .skip(parsimmon.optWhitespace),
        binaryLeft(
          parsimmon
            .alt(
              parsimmon.string("*"),
              parsimmon.string("/"),
              parsimmon.string("%"),
            )
            .skip(parsimmon.optWhitespace),
          parsimmon.alt(
            r.Value,
            r.Parameter,
            r.Expression.wrap(
              parsimmon.string("(").skip(parsimmon.optWhitespace),
              parsimmon.string(")").skip(parsimmon.optWhitespace),
            ),
          ),
        ),
      ),
    );
  },
  Comparison: function (r) {
    return parsimmon.alt(
      parsimmon.seqMap(r.ValueExpression, r.IsNullOperator, (p, o) => [o, p]),
      parsimmon.seqMap(
        r.ValueExpression,
        r.ComparisonOperator,
        r.ValueExpression,
        (p, o, v) => [o, p, v],
      ),
      parsimmon.seqMap(
        r.ValueExpression,
        r.LikeOperator,
        r.ValueExpression.skip(
          parsimmon
            .regexp(/escape/i)
            .result("ESCAPE")
            .skip(parsimmon.whitespace)
            .desc("ESCAPE"),
        ),
        r.ValueExpression,
        (a, b, c, d) => [b, a, c, d],
      ),
      parsimmon.seqMap(
        r.ValueExpression,
        r.LikeOperator,
        r.ValueExpression,
        (a, b, c) => [b, a, c],
      ),
    );
  },
  ExpressionList: function (r) {
    return r.Expression.sepBy(
      parsimmon.string(",").skip(parsimmon.optWhitespace),
    );
  },
  Expression: function (r) {
    function unary(
      operatorsParser: parsimmon.Parser<string>,
      nextParser: parsimmon.Parser<Expression>,
    ): parsimmon.Parser<Expression> {
      return parsimmon.seq(operatorsParser, nextParser).or(nextParser);
    }

    return binaryLeft(
      r.OrOperator,
      binaryLeft(
        r.AndOperator,
        unary(r.NotOperator, r.Comparison.or(r.ValueExpression)),
      ),
    ).trim(parsimmon.optWhitespace);
  },
});

export function parse(str: string): Expression {
  if (!str) return null;
  return lang.Expression.tryParse(str);
}

export function parseList(str: string): Expression[] {
  if (!str) return [];
  return lang.ExpressionList.tryParse(str);
}

export function stringify(exp: Expression, level = 0): string {
  if (!Array.isArray(exp)) return JSON.stringify(exp);

  const opLevels: Record<string, number> = {
    OR: 10,
    AND: 11,
    NOT: 12,
    "=": 20,
    "<>": 20,
    ">": 20,
    ">=": 20,
    "<": 20,
    "<=": 20,
    LIKE: 20,
    "NOT LIKE": 20,
    "IS NULL": 20,
    "IS NOT NULL": 20,
    "||": 30,
    "+": 31,
    "-": 31,
    "*": 32,
    "/": 32,
    "%": 32,
  };

  const op = exp[0].toUpperCase();

  function wrap(e: string): string {
    if (opLevels[op] <= level) return `(${e})`;
    else return e;
  }

  if (op === "FUNC") {
    return wrap(
      `${exp[1]}(${exp
        .slice(2)
        .map((e) => stringify(e))
        .join(", ")})`,
    );
  } else if (op === "PARAM") {
    if (typeof exp[1] === "string") {
      return wrap(exp[1]);
    } else if (Array.isArray(exp[1]) && exp[1][0] === "||") {
      return wrap(
        exp[1]
          .slice(1)
          .map((p) => {
            if (typeof p === "string") return p;
            else return `{${stringify(p)}}`;
          })
          .join(""),
      );
    } else {
      return wrap(`{${stringify(exp[1])}}`);
    }
  } else if (op === "IS NULL" || op === "IS NOT NULL") {
    return wrap(`${stringify(exp[1], opLevels[op])} ${op}`);
  } else if (op === "LIKE" || op === "NOT LIKE") {
    if (exp[3]) {
      return wrap(
        `${stringify(exp[1], opLevels[op])} ${op} ${stringify(
          exp[2],
          opLevels[op],
        )} ESCAPE ${stringify(exp[3], opLevels[op])}`,
      );
    } else {
      return wrap(
        `${stringify(exp[1], opLevels[op])} ${op} ${stringify(
          exp[2],
          opLevels[op],
        )}`,
      );
    }
  } else if (op === "CASE") {
    const parts: string[] = ["CASE"];
    for (let i = 1; i < exp.length - 1; i += 2) {
      if (!Array.isArray(exp[i]) && exp[i]) {
        if (exp[i + 1] != null) parts.push("ELSE", stringify(exp[i + 1]));
        break;
      }
      parts.push("WHEN", stringify(exp[i]), "THEN", stringify(exp[i + 1]));
    }
    parts.push("END");
    return parts.join(" ");
  } else if (op in opLevels) {
    const parts = exp.slice(1).map((e, i) => {
      return stringify(e, opLevels[exp[0]] + Math.min(i - 1, 0));
    });

    if (op === "NOT") return wrap(`${op} ${parts[0]}`);
    else return wrap(parts.join(` ${op} `));
  } else {
    throw new Error(`Unrecognized operator ${exp[0]}`);
  }
}

// LIKE tokenizer: literal characters stay RAW (escaping happens in
// likePatternToRegExp, fixing the old mapping of a literal backslash to
// a slash); tokens "\\%" and "\\_" mark the SQL wildcards. Consecutive %
// collapse into one wildcard. Budgets fail with a controlled error.
export const LIKE_PATTERN_MAX = 4096;
export const LIKE_WILDCARDS_MAX = 32;

export function parseLikePattern(pat: string, esc: string): string[] {
  if (pat.length > LIKE_PATTERN_MAX)
    throw new Error(
      `VALIDATION LIKE pattern exceeds ${LIKE_PATTERN_MAX} characters`,
    );

  const tokens: string[] = [];
  let wildcards = 0;
  for (let i = 0; i < pat.length; ++i) {
    const c = pat[i];
    if (esc && c === esc) {
      const next = pat[i + 1];
      if (next === undefined)
        throw new Error(
          `VALIDATION LIKE pattern has a dangling escape at index ${i}`,
        );
      // The escaped character is always literal — including % and _.
      tokens.push(next);
      i += 1;
      continue;
    }
    if (c === "%") {
      wildcards += 1;
      if (wildcards > LIKE_WILDCARDS_MAX)
        throw new Error(
          `VALIDATION LIKE pattern exceeds ${LIKE_WILDCARDS_MAX} wildcards`,
        );
      if (tokens[tokens.length - 1] !== "\\%") tokens.push("\\%");
      continue;
    }
    if (c === "_") {
      wildcards += 1;
      if (wildcards > LIKE_WILDCARDS_MAX)
        throw new Error(
          `VALIDATION LIKE pattern exceeds ${LIKE_WILDCARDS_MAX} wildcards`,
        );
      tokens.push("\\_");
      continue;
    }
    tokens.push(c);
  }
  return tokens;
}
