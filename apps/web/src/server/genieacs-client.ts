// Server-side (BFF) client for the engine UI API. Internal fixed base
// URL, forwards ONLY the accepted native cookie name, never passes an
// Authorization header through, no-store everywhere, bounded timeouts,
// and strips Set-Cookie from generic responses (login/logout handle
// cookies explicitly).
import { NextResponse } from "next/server";
import { TRUSTED_DIRECT_MARKER } from "./correlation";

export const GENIEACS_UI_URL = process.env.GENIEACS_UI_URL ?? "http://ui:7583";
const NATIVE_COOKIE = "genieacs-ui-jwt";
// ONE cookie contract end to end (contracts.md "Identitas dan
// otorisasi" #1): the BFF stores the native JWT under the NATIVE cookie
// name, so login, logout, the dashboard layout and every BFF reader
// agree without per-route constants.
export const APP_COOKIE_NAME = NATIVE_COOKIE;

export interface UpstreamInit {
  method?: string;
  body?: string;
  cookie?: string | null;
  timeoutMs?: number;
  requestId?: string;
}

export async function engineFetch(
  path: string,
  init: UpstreamInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie) headers["Cookie"] = `${NATIVE_COOKIE}=${init.cookie}`;
  // Correlation: a valid UUID requestId travels to the engine so log
  // lines join across the BFF -> engine hop.
  if (init.requestId) headers["X-Request-Id"] = init.requestId;

  return fetch(`${GENIEACS_UI_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    cache: "no-store",
  });
}

// Client address for rate limiting. X-Forwarded-For is client-settable:
// it is honored ONLY when the deployment sits behind
// TRUSTED_PROXY_HOPS trusted proxies (each appending the peer it saw),
// taking the entry that many hops from the right. With the default 0 the
// proxy strips the header and Next's HTTP server re-injects the TCP
// socket address; that server-derived value is trusted ONLY when the
// proxy marker is present (a forged marker is deleted by the proxy, and
// without the proxy the header stays client-supplied → "direct"). Either
// way, rotating a client-sent header can never open new buckets.
export function clientIpForRateLimit(request: Request): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  if (Number.isInteger(hops) && hops > 0) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const index = parts.length - hops;
      if (index >= 0) return parts[index];
    }
    return "direct";
  }
  if (request.headers.get(TRUSTED_DIRECT_MARKER) === "1") {
    // Hops=0: the proxy deleted the inbound chain, so this single entry
    // is the socket peer Next injected. ::ffff: IPv6-mapped prefixes are
    // normalized so v4 peers key consistently.
    const peer = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (peer) return peer.replace(/^::ffff:/i, "");
  }
  return "direct";
}

// Copy a response body through WITHOUT upstream Set-Cookie leakage.
export async function passJson(
  upstream: Response,
  requestId: string,
  status?: number,
): Promise<NextResponse> {
  const text = await upstream.text();
  return new NextResponse(text, {
    status: status ?? upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

export function nativeCookieFrom(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  // The BFF session cookie carries the native JWT under the native
  // name (APP_COOKIE_NAME); anything else in the header is ignored.
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === APP_COOKIE_NAME) return rest.join("=");
  }
  return null;
}

// Same-origin enforcement for state-changing app routes.
export function requireSameOrigin(
  request: Request,
  publicOrigin: string,
): { ok: true } | { ok: false; reason: string } {
  const origin = request.headers.get("origin");
  if (!origin) return { ok: false, reason: "missing origin" };
  try {
    if (new URL(origin).origin !== new URL(publicOrigin).origin)
      return { ok: false, reason: "origin mismatch" };
  } catch {
    return { ok: false, reason: "invalid origin" };
  }
  if (request.headers.get("x-app-request") !== "1")
    return { ok: false, reason: "missing x-app-request" };
  return { ok: true };
}
