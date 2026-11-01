import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
} from "../../../../server/genieacs-client";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export async function POST(request: Request): Promise<NextResponse> {
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
        requestId: "password",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
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
        requestId: "password",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
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
        requestId: "password",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const upstream = await engineFetch("/api/password", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        oldPassword: body.oldPassword ?? "",
        newPassword: body.newPassword ?? "",
      }),
    });
    if (upstream.status === 204)
      return NextResponse.json(
        { ok: true, data: { changed: true }, requestId: "password" },
        { status: 200, headers: { "Cache-Control": "no-store" } },
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
          requestId: "password",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
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
          requestId: "password",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
        requestId: "password",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
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
        requestId: "password",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
