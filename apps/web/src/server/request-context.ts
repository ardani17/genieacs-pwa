// Request correlation: every web request gets a UUID observed for
// duration/outcome and echoed back on the response. The same id travels
// to the engine and vpn services on upstream calls. The audit identity
// is minted by the PROXY (apps/web/src/proxy.ts) for every /api/app/*
// request; the inbound UUID — when valid — is recorded as the PARENT,
// never as the identity itself (contracts.md "identitas audit server,
// inbound parent").
import { getAppLogger } from "./logger.ts";
import {
  PARENT_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
  UUID_RE,
} from "./correlation";

export interface RequestContext {
  requestId: string;
  parentRequestId?: string;
  startedAt: number;
}

export function requestIdFrom(header?: string | null): string {
  if (header && UUID_RE.test(header)) return header;
  return crypto.randomUUID();
}

// Route handlers receive the id from the proxy (which always mints a
// fresh server UUID and overwrites any inbound value, so this header is
// server-owned by the time handlers run); this re-derives safely when
// called without one (tests, internal calls). The parent is picked up
// only when it is a valid UUID.
export function requestContextFrom(request: Request): RequestContext {
  const parent = request.headers.get(PARENT_REQUEST_ID_HEADER);
  return {
    requestId: requestIdFrom(request.headers.get(REQUEST_ID_HEADER)),
    ...(parent && UUID_RE.test(parent) ? { parentRequestId: parent } : {}),
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
    ...(ctx.parentRequestId ? { parentRequestId: ctx.parentRequestId } : {}),
    ...(actorId ? { actorId } : {}),
    durationMs: Date.now() - ctx.startedAt,
    outcome,
    message,
  });
}
