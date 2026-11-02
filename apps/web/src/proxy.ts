import { NextResponse, type NextRequest } from "next/server";

// Request correlation for every /api/app/* call: a valid UUID
// X-Request-Id from a trusted parent is inherited, anything else is
// replaced with a fresh UUID. The id is forwarded to the route handlers
// (request header), echoed to the browser (response header) and sent to
// the engine on upstream calls, so one id joins browser, BFF log events
// and engine access logs.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function proxy(request: NextRequest) {
  const parent = request.headers.get("x-request-id");
  const requestId =
    parent && UUID_RE.test(parent) ? parent : crypto.randomUUID();

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: "/api/app/:path*",
};
