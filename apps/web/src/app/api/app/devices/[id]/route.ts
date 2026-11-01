import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import { maskDeviceForUi } from "@/server/mask-device";

export const dynamic = "force-dynamic";

// Single-device detail with secret masking on parameter values.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
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
        requestId: "device-detail",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const upstream = await engineFetch(
      `/api/devices/${encodeURIComponent(id)}`,
      { cookie },
    );
    if (upstream.status === 404)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Device not found",
            retryable: false,
          },
          requestId: "device-detail",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    if (upstream.status === 403)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "No permission",
            retryable: false,
          },
          requestId: "device-detail",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BACKEND_UNAVAILABLE",
            message: "Upstream unavailable",
            retryable: true,
          },
          requestId: "device-detail",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );

    const device = (await upstream.json()) as Record<string, unknown>;
    return NextResponse.json(
      {
        ok: true,
        data: maskDeviceForUi(device),
        requestId: "device-detail",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Upstream unavailable",
          retryable: true,
        },
        requestId: "device-detail",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
