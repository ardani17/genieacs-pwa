import { NextResponse, type NextRequest } from "next/server";
import {
  PARENT_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
  TRUSTED_DIRECT_MARKER,
  UUID_RE,
} from "./server/correlation";

// Request correlation for every /api/app/* call (contracts.md "identitas
// audit server, inbound parent"): the audit identity is ALWAYS a fresh
// server-minted UUID. A valid UUID X-Request-Id from a trusted parent is
// recorded as the PARENT header; anything else is dropped. The minted id
// is forwarded to the route handlers (request header), echoed to the
// browser (response header) and sent to the engine on upstream calls, so
// one id joins browser, BFF log events and engine access logs.
//
// Client address for rate limiting (RE-STD-08): with
// TRUSTED_PROXY_HOPS=0 the proxy DELETES the client-supplied (spoofable)
// X-Forwarded-For and marks the request; Next's own HTTP server then
// fills the absent header with the TCP socket address (base-server
// `??=`), so the value the handlers see is server-derived. With
// TRUSTED_PROXY_HOPS>0 the edge proxy's XFF chain is trusted as-is and
// left untouched.
//
// CSRF choke point (contracts.md "Identitas dan otorisasi" #6): every
// non-GET /api/app request must carry Origin == PUBLIC_ORIGIN and
// X-App-Request: 1, else it is rejected here — fail-closed on a missing
// Origin. SameSite cookies do NOT protect against same-site sibling
// origins, so this server-side check is the real boundary. Route
// handlers repeat the same check as defense in depth.
export default function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();

  // Safe read methods stay open; every state-changing method is gated.
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "OPTIONS"
  ) {
    const publicOrigin = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";
    const origin = request.headers.get("origin");
    let originOk = false;
    if (origin) {
      try {
        originOk = new URL(origin).origin === new URL(publicOrigin).origin;
      } catch {
        originOk = false;
      }
    }
    if (!originOk || request.headers.get("x-app-request") !== "1") {
      const response = new NextResponse(
        JSON.stringify({
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Permintaan ditolak (same-origin)",
            retryable: false,
          },
          requestId,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    }
  }

  const inbound = request.headers.get(REQUEST_ID_HEADER);

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.delete(PARENT_REQUEST_ID_HEADER);
  if (inbound && UUID_RE.test(inbound))
    headers.set(PARENT_REQUEST_ID_HEADER, inbound);

  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  headers.delete(TRUSTED_DIRECT_MARKER);
  if (!(Number.isInteger(hops) && hops > 0)) {
    headers.delete("x-forwarded-for");
    headers.set(TRUSTED_DIRECT_MARKER, "1");
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: "/api/app/:path*",
};
