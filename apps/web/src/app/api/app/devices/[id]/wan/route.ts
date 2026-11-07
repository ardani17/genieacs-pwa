import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
} from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

// Phased WAN operation (write → refresh → binding reapply → verify).
// The task budget matches the commands route; lost connections surface
// RESULT_UNKNOWN with the operations lookup for recovery — never an
// automatic retry.
export async function POST(
  request: Request,
  paramsCtx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const { id } = await paramsCtx.params;

  // Contracts.md mutation rules: same-origin + X-App-Request on every
  // state-changing route, checked BEFORE the body is read or the
  // upstream is contacted.
  const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
  if (!sameOrigin.ok)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Permintaan ditolak (same-origin)",
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      { status: 403, headers: correlationHeaders(ctx) },
    );
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
      `/api/app/devices/${encodeURIComponent(id)}/wan`,
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
            message: "Tidak ada izin operasi WAN",
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
            message: "Operasi WAN lain sedang berjalan atau ID sudah dipakai",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 409, headers: correlationHeaders(ctx) },
      );
    if (upstream.status === 400) {
      const upstreamBody = (await upstream.json()) as {
        error?: { code?: string; message?: string };
      };
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: upstreamBody.error?.code ?? "VALIDATION",
            message: upstreamBody.error?.message ?? "Operasi WAN tidak valid",
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
            message: "Operasi WAN tidak dapat dijalankan",
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
