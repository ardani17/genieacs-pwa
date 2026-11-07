import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";
import { maskDeviceCsv } from "@/server/mask-device";

export const dynamic = "force-dynamic";

// Per-device parameter CSV: proxies the native single-device CSV
// (permission-filtered server-side), streaming with a sanitized
// disposition. No JSON envelope.
export async function GET(
  request: Request,
  paramsCtx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const { id } = await paramsCtx.params;
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
    const upstream = await engineFetch(
      `/api/devices/${encodeURIComponent(id)}.csv`,
      { cookie, requestId: ctx.requestId, timeoutMs: 15_000 },
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
          requestId: ctx.requestId,
        },
        { status: 404, headers: correlationHeaders(ctx) },
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
          requestId: ctx.requestId,
        },
        { status: 403, headers: correlationHeaders(ctx) },
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
          requestId: ctx.requestId,
        },
        { status: 503, headers: correlationHeaders(ctx) },
      );

    // Secret parameter values are masked BEFORE the bytes cross the
    // BFF (same policy as every other device path).
    const data = maskDeviceCsv(await upstream.text());
    const safeName = `device-${id.replace(/[^A-Za-z0-9._-]/g, "_")}.csv`;
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        ...correlationHeaders(ctx),
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
        requestId: ctx.requestId,
      },
      { status: 503, headers: correlationHeaders(ctx) },
    );
  }
}
