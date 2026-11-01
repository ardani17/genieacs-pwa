import { NextResponse } from "next/server";
import { nativeCookieFrom, engineFetch } from "@/server/genieacs-client";

export const dynamic = "force-dynamic";

// VPN status via the engine (native vpn permission enforced there).
// Until the controller management lands (M07), the honest states are
// unconfigured/unavailable — never "connected" from container liveness.
export async function GET(request: Request): Promise<NextResponse> {
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
        requestId: "vpn-status",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const upstream = await engineFetch("/api/app/vpn/status", {
      cookie,
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
          requestId: "vpn-status",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
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
          requestId: "vpn-status",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
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
          requestId: "vpn-status",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    const data = await upstream.json();
    return NextResponse.json(
      { ok: true, data, requestId: "vpn-status" },
      { headers: { "Cache-Control": "no-store" } },
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
        requestId: "vpn-status",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
