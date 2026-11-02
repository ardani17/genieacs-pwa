import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
  APP_COOKIE_NAME,
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
        requestId: "logout",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );

  // Best-effort native logout; the BFF cookie is cleared regardless —
  // no redirect loops, no-store.
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (cookie)
    void engineFetch("/logout", { method: "POST", cookie }).catch(() => {});

  const secure = PUBLIC_ORIGIN.startsWith("https://");
  return NextResponse.json(
    { ok: true, data: { authenticated: false }, requestId: "logout" },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${APP_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
      },
    },
  );
}
