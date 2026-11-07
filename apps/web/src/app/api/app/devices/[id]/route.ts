import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";
import { maskDeviceForUi } from "@/server/mask-device";

export const dynamic = "force-dynamic";

// Single-device detail with secret masking on parameter values.
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
      `/api/devices/${encodeURIComponent(id)}`,
      { cookie, requestId: ctx.requestId },
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
            message: "No permission",
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
            message: "Upstream unavailable",
            retryable: true,
          },
          requestId: ctx.requestId,
        },
        { status: 502, headers: correlationHeaders(ctx) },
      );

    const device = (await upstream.json()) as Record<string, unknown>;
    return NextResponse.json(
      {
        ok: true,
        data: maskDeviceForUi(device),
        requestId: ctx.requestId,
      },
      { headers: correlationHeaders(ctx) },
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
        requestId: ctx.requestId,
      },
      { status: 502, headers: correlationHeaders(ctx) },
    );
  }
}
