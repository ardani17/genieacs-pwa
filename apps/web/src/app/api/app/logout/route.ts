import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
  APP_COOKIE_NAME,
} from "../../../../server/genieacs-client";
import {
  requestContextFrom,
  observeRequest,
  correlationHeaders,
} from "../../../../server/request-context";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
  if (!sameOrigin.ok) {
    observeRequest(ctx, "failure", "logout 403");
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
  }

  // Best-effort native logout; the BFF cookie is cleared regardless —
  // no redirect loops, no-store.
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (cookie)
    void engineFetch("/logout", {
      method: "POST",
      cookie,
      requestId: ctx.requestId,
    }).catch(() => {});

  const secure = PUBLIC_ORIGIN.startsWith("https://");
  observeRequest(ctx, "success", "logout 200");
  return NextResponse.json(
    { ok: true, data: { authenticated: false }, requestId: ctx.requestId },
    {
      status: 200,
      headers: {
        ...correlationHeaders(ctx),
        "Set-Cookie": `${APP_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
      },
    },
  );
}
