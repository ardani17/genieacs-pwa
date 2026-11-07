// Single-pass CWMP cookie scanner (CodeQL #16).
//
// The old global regex /\s*([a-zA-Z0-9\-_]+?)\s*=\s*"?([a-zA-Z0-9\-_]*?)"?\s*(,|;|$)/g
// combined lazy quantifiers with an end-of-input alternation and
// backtracked superlinearly on adversarial headers. This bounded loop
// walks the header exactly once. Some CPEs separate cookies with commas
// instead of semicolons — both delimiters are honored — and the LAST
// valid session pair wins, matching the baseline.

export const CWMP_COOKIE_HEADER_MAX_BYTES = 8192;

export class CwmpCookieError extends Error {
  code: "CWMP_COOKIE";
  exposeStatus: number;

  constructor(message: string, exposeStatus: number) {
    super(message);
    this.name = "Error";
    this.code = "CWMP_COOKIE";
    this.exposeStatus = exposeStatus;
  }
}

function isTokenChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x2d || // -
    code === 0x5f // _
  );
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09; // space, tab
}

export function getCwmpSessionId(
  cookie: string | undefined,
): string | undefined {
  if (cookie === undefined) return undefined;
  if (Buffer.byteLength(cookie, "utf8") > CWMP_COOKIE_HEADER_MAX_BYTES)
    throw new CwmpCookieError(
      `CWMP_COOKIE cookie header exceeds ${CWMP_COOKIE_HEADER_MAX_BYTES} bytes`,
      431,
    );

  let sessionId: string | undefined;
  let i = 0;
  const n = cookie.length;

  while (i < n) {
    while (i < n && isSpace(cookie.charCodeAt(i))) ++i;

    const keyStart = i;
    while (i < n && isTokenChar(cookie.charCodeAt(i))) ++i;
    const keyEnd = i;

    while (i < n && isSpace(cookie.charCodeAt(i))) ++i;

    if (cookie[i] !== "=") {
      // Skip the malformed pair; when no delimiter follows, resync one
      // character ahead so later valid pairs stay reachable (the old
      // regex retried at every position).
      const d =
        cookie.indexOf(",", i) === -1
          ? cookie.indexOf(";", i)
          : Math.min(
              ...[cookie.indexOf(",", i), cookie.indexOf(";", i)].filter(
                (x) => x !== -1,
              ),
            );
      i = d === -1 ? i + 1 : d + 1;
      continue;
    }
    ++i; // consume '='

    while (i < n && isSpace(cookie.charCodeAt(i))) ++i;

    const quoted = cookie[i] === '"';
    if (quoted) ++i;

    const valStart = i;
    while (i < n && isTokenChar(cookie.charCodeAt(i))) ++i;
    const valEnd = i;

    if (quoted) {
      if (cookie[i] !== '"') {
        // Unterminated quote: skip to the next delimiter and ignore it.
        while (i < n && cookie[i] !== "," && cookie[i] !== ";") ++i;
        if (i < n) ++i;
        continue;
      }
      ++i;
    }

    while (i < n && isSpace(cookie.charCodeAt(i))) ++i;
    if (i < n && cookie[i] !== "," && cookie[i] !== ";") {
      // Skip the malformed pair; when no delimiter follows, resync one
      // character ahead so later valid pairs stay reachable (the old
      // regex retried at every position).
      const d =
        cookie.indexOf(",", i) === -1
          ? cookie.indexOf(";", i)
          : Math.min(
              ...[cookie.indexOf(",", i), cookie.indexOf(";", i)].filter(
                (x) => x !== -1,
              ),
            );
      i = d === -1 ? i + 1 : d + 1;
      continue;
    }
    if (i < n) ++i; // consume the delimiter

    if (keyEnd > keyStart) {
      const key = cookie.slice(keyStart, keyEnd);
      const value = cookie.slice(valStart, valEnd);
      if (key === "session") sessionId = value; // last valid pair wins
    }
  }

  return sessionId;
}
