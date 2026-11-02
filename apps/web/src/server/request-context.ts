// Request correlation: every web request gets a UUID (inherited from a
// valid X-Request-Id parent), observed for duration/outcome and echoed
// back on the response. The same id travels to the engine and vpn
// services on upstream calls.
import { getAppLogger } from "./logger.ts";

export interface RequestContext {
  requestId: string;
  startedAt: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdFrom(header?: string | null): string {
  if (header && UUID_RE.test(header)) return header;
  return crypto.randomUUID();
}

// Route handlers receive the id from middleware (which already mints or
// inherits a UUID); this re-derives safely when called without one.
export function requestContextFrom(request: Request): RequestContext {
  return {
    requestId: requestIdFrom(request.headers.get("x-request-id")),
    startedAt: Date.now(),
  };
}

// Standard response headers carrying the correlation id.
export function correlationHeaders(
  ctx: RequestContext,
): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Request-Id": ctx.requestId };
}

export function observeRequest(
  ctx: RequestContext,
  outcome: "success" | "failure" | "partial" | "unknown",
  message: string,
  actorId?: string,
): void {
  getAppLogger().emit({
    event: "http.request.completed",
    level: outcome === "failure" ? "warn" : "info",
    requestId: ctx.requestId,
    ...(actorId ? { actorId } : {}),
    durationMs: Date.now() - ctx.startedAt,
    outcome,
    message,
  });
}
