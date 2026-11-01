import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";

export const dynamic = "force-dynamic";

// Per-device parameter CSV: proxies the native single-device CSV
// (permission-filtered server-side), streaming with a sanitized
// disposition. No JSON envelope.
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
        requestId: "device-csv",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const upstream = await engineFetch(
      `/api/devices/${encodeURIComponent(id)}.csv`,
      { cookie, timeoutMs: 15_000 },
    );
    if (upstream.status === 404)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Perangkat tidak ditemukan",
            retryable: false,
          },
          requestId: "device-csv",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    if (upstream.status === 403)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak ada izin",
            retryable: false,
          },
          requestId: "device-csv",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BACKEND_UNAVAILABLE",
            message: "Gagal membuat CSV",
            retryable: true,
          },
          requestId: "device-csv",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );

    const data = await upstream.arrayBuffer();
    const safeName = `device-${id.replace(/[^A-Za-z0-9._-]/g, "_")}.csv`;
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Gagal membuat CSV",
          retryable: true,
        },
        requestId: "device-csv",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
