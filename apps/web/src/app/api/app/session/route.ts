import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  passJson,
} from "../../../../server/genieacs-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
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
        requestId: "session",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const upstream = await engineFetch("/api/session", { cookie });
    if (upstream.status === 401)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Not authenticated",
            retryable: false,
          },
          requestId: "session",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    return passJson(upstream, "session");
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
        requestId: "session",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
