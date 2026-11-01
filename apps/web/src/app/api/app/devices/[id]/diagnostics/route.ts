import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";

export const dynamic = "force-dynamic";

// Device diagnostics through the engine: permission + filter enforced
// there; the browser supplies ONLY the device id (no host/port args).
export async function POST(
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
        requestId: "device-diagnostics",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const upstream = await engineFetch(
      `/api/app/devices/${encodeURIComponent(id)}/diagnostics`,
      { method: "POST", cookie, timeoutMs: 8000 },
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
          requestId: "device-diagnostics",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    if (upstream.status === 403)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak ada izin diagnostik",
            retryable: false,
          },
          requestId: "device-diagnostics",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "DEVICE_UNREACHABLE",
            message: "Diagnostik tidak tersedia",
            retryable: true,
          },
          requestId: "device-diagnostics",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    const data = await upstream.json();
    return NextResponse.json(
      { ok: true, data, requestId: "device-diagnostics" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TIMEOUT",
          message: "Diagnostik kehabisan waktu",
          retryable: true,
        },
        requestId: "device-diagnostics",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
