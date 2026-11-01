// Server-side (BFF) client for the engine UI API. Internal fixed base
// URL, forwards ONLY the accepted native cookie name, never passes an
// Authorization header through, no-store everywhere, bounded timeouts,
// and strips Set-Cookie from generic responses (login/logout handle
// cookies explicitly).
import { NextResponse } from "next/server";

export const GENIEACS_UI_URL = process.env.GENIEACS_UI_URL ?? "http://ui:7583";
const NATIVE_COOKIE = "genieacs-ui-jwt";

export interface UpstreamInit {
  method?: string;
  body?: string;
  cookie?: string | null;
  timeoutMs?: number;
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

  return fetch(`${GENIEACS_UI_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    cache: "no-store",
  });
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
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === NATIVE_COOKIE) return rest.join("=");
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
