import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

export const dynamic = "force-dynamic";

// Device tags through the NATIVE tag route (verb-specific, not a
// generic device PUT): the engine enforces devices:3 + the caller's
// filter + the native tags validator.
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
      `/api/devices/${encodeURIComponent(id)}/tags`,
      {
        method: "POST",
        body,
        cookie,
        requestId: ctx.requestId,
        timeoutMs: 10_000,
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
            message: "Tidak ada izin mengubah tags",
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
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "Tags tidak dapat diperbarui",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 400, headers: correlationHeaders(ctx) },
      );
    return NextResponse.json(
      { ok: true, data: {}, requestId: ctx.requestId },
      { headers: correlationHeaders(ctx) },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TIMEOUT",
          message: "Pembaruan tags kehabisan waktu",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 504, headers: correlationHeaders(ctx) },
    );
  }
}
