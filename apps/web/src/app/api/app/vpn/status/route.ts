import { NextResponse } from "next/server";
import { nativeCookieFrom, engineFetch } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

export const dynamic = "force-dynamic";

// VPN status via the engine (native vpn permission enforced there).
// Until the controller management lands (M07), the honest states are
// unconfigured/unavailable — never "connected" from container liveness.
export async function GET(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Not authenticated",
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      { status: 401, headers: correlationHeaders(ctx) },
    );

  try {
    const upstream = await engineFetch("/api/app/vpn/status", {
      cookie,
      requestId: ctx.requestId,
      timeoutMs: 5000,
    });
    if (upstream.status === 403)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "No VPN permission",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 403, headers: correlationHeaders(ctx) },
      );
    if (upstream.status === 401)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Not authenticated",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 401, headers: correlationHeaders(ctx) },
      );
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: true,
          data: {
            state: "unavailable",
            reason: "vpn controller not reachable",
            observedAt: new Date().toISOString(),
            controllerReachable: false,
            lastSuccessAt: null,
          },
          requestId: ctx.requestId,
        },
        { status: 200, headers: correlationHeaders(ctx) },
      );
    const data = await upstream.json();
    return NextResponse.json(
      { ok: true, data, requestId: ctx.requestId },
      { headers: correlationHeaders(ctx) },
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        data: {
          state: "unavailable",
          reason: "vpn controller not reachable",
          observedAt: new Date().toISOString(),
          controllerReachable: false,
          lastSuccessAt: null,
        },
        requestId: ctx.requestId,
      },
      { status: 200, headers: correlationHeaders(ctx) },
    );
  }
}
