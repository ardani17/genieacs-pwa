import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

export const dynamic = "force-dynamic";

export async function PUT(
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
      `/api/app/admin/users/${encodeURIComponent(id)}/roles`,
      {
        method: "PUT",
        body,
        cookie,
        requestId: ctx.requestId,
        timeoutMs: 15_000,
      },
    );
    const data = await upstream.json().catch(() => null);
    if (data && typeof data === "object" && "ok" in data)
      return NextResponse.json(
        { ...data, requestId: ctx.requestId },
        { status: upstream.status, headers: correlationHeaders(ctx) },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: "Respon tidak valid",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 502, headers: correlationHeaders(ctx) },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TIMEOUT",
          message: "Kebihabisan waktu",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 504, headers: correlationHeaders(ctx) },
    );
  }
}
