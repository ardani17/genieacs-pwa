import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

export const dynamic = "force-dynamic";

// Device commands through the guarded executor: the BFF waits up to the
// task budget (310s — native socket 300s + await session 120s overlap
// is bounded by the engine's own socket timeout), never retries, and
// surfaces RESULT_UNKNOWN-style states from the payload, not the HTTP
// status.
export async function POST(
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

  const body = await request.text();
  try {
    const upstream = await engineFetch(
      `/api/app/devices/${encodeURIComponent(id)}/commands`,
      {
        method: "POST",
        body,
        cookie,
        requestId: ctx.requestId,
        timeoutMs: 310_000,
      },
    );
    if (upstream.status === 401)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Sesi berakhir",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 401, headers: correlationHeaders(ctx) },
      );
    if (upstream.status === 403)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Tidak ada izin menjalankan perintah",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 403, headers: correlationHeaders(ctx) },
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
    if (upstream.status === 409)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Operasi dengan ID ini sudah dipakai request lain",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 409, headers: correlationHeaders(ctx) },
      );
    if (upstream.status === 400) {
      const upstreamBody = (await upstream.json()) as {
        error?: { message?: string };
      };
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message:
              upstreamBody.error?.message ?? "Perintah perangkat tidak valid",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 400, headers: correlationHeaders(ctx) },
      );
    }
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BACKEND_UNAVAILABLE",
            message: "Perintah tidak dapat dijalankan",
            retryable: true,
          },
          requestId: ctx.requestId,
        },
        { status: 503, headers: correlationHeaders(ctx) },
      );
    const data = await upstream.json();
    return NextResponse.json(
      { ...data, requestId: ctx.requestId },
      { headers: correlationHeaders(ctx) },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RESULT_UNKNOWN",
          message:
            "Koneksi terputus; hasil belum terkonfirmasi. Periksa hasil operasi.",
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      { status: 504, headers: correlationHeaders(ctx) },
    );
  }
}
