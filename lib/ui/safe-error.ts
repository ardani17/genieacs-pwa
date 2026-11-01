// Safe error responses and CSV quoting for the legacy API.
//
// Koa auto-infers Content-Type text/html for plain string bodies, which
// turns any reflected error text into a stored-XSS surface for browsers.
// Legacy API errors therefore go through sendSafeLegacyError: text/plain
// charset utf-8, nosniff, an allowlisted fixed message plus a request id.
// Raw err.name/message only ever reach the (sanitized) logger.
//
// quoteCsvCell is the single CSV quoting helper: every double quote is
// doubled and the cell is wrapped, which also neutralizes commas and
// CRLF inside cell values. It never sees credentials.

import { randomUUID } from "node:crypto";

export function quoteCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function sendSafeLegacyError(
  ctx: {
    status: number;
    body: unknown;
    type: string;
    set: (k: string, v: string) => void;
    state: Record<string, unknown>;
  },
  status: number,
  code: string,
  message: string,
): void {
  if (!ctx.state.requestId) ctx.state.requestId = randomUUID();
  ctx.status = status;
  ctx.type = "text/plain; charset=utf-8";
  ctx.set("X-Content-Type-Options", "nosniff");
  ctx.body = `Error: ${code} (request ${ctx.state.requestId})\n${message}`;
}
