import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

export const dynamic = "force-dynamic";

// Stored operation outcome: the engine enforces owner/admin permission
// and never re-submits. Losing the browser connection does not lose the
// evidence — this is the refresh-results path.
export async function GET(
  request: Request,
  paramsCtx: { params: Promise<{ operationId: string }> },
): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const { operationId } = await paramsCtx.params;
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
      `/api/app/operations/${encodeURIComponent(operationId)}`,
      { cookie, requestId: ctx.requestId, timeoutMs: 10_000 },
    );
    if (upstream.status === 404)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Operasi tidak ditemukan",
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
            message: "Tidak ada izin membaca operasi",
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
            message: "Hasil operasi tidak tersedia",
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
          code: "TIMEOUT",
          message: "Pengambilan hasil kehabisan waktu",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 504, headers: correlationHeaders(ctx) },
    );
  }
}
