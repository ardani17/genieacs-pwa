import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
} from "../../../../server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "../../../../server/request-context";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
  if (!sameOrigin.ok)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Cross-origin request rejected",
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

  let body: { oldPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Malformed body",
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      { status: 400, headers: correlationHeaders(ctx) },
    );
  }

  try {
    const upstream = await engineFetch("/api/password", {
      method: "POST",
      cookie,
      requestId: ctx.requestId,
      body: JSON.stringify({
        oldPassword: body.oldPassword ?? "",
        newPassword: body.newPassword ?? "",
      }),
    });
    if (upstream.status === 204)
      return NextResponse.json(
        { ok: true, data: { changed: true }, requestId: ctx.requestId },
        { status: 200, headers: correlationHeaders(ctx) },
      );
    if (upstream.status === 401)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication failed, check your current password",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 401, headers: correlationHeaders(ctx) },
      );
    if (upstream.status === 400)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "The new password does not meet the policy",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 400, headers: correlationHeaders(ctx) },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
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
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 502, headers: correlationHeaders(ctx) },
    );
  }
}
