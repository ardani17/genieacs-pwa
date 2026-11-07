import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
} from "../../../../server/genieacs-client";
import {
  requestContextFrom,
  observeRequest,
  correlationHeaders,
} from "../../../../server/request-context";

export const dynamic = "force-dynamic";

// Session introspection: the NATIVE SessionDTO passes through (no
// ok/data envelope), correlated and observed on every exit.
export async function GET(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const done = (status: number, body?: NextResponse): NextResponse => {
    observeRequest(
      ctx,
      status < 400 ? "success" : status < 500 ? "failure" : "partial",
      `session ${status}`,
    );
    if (body) return body;
    return new NextResponse(null, {
      status,
      headers: correlationHeaders(ctx),
    });
  };

  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie)
    return done(
      401,
      NextResponse.json(
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
      ),
    );

  try {
    const upstream = await engineFetch("/api/session", {
      cookie,
      requestId: ctx.requestId,
    });
    if (upstream.status === 401)
      return done(
        401,
        NextResponse.json(
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
        ),
      );

    // The native DTO body passes through with the correlation header.
    const text = await upstream.text();
    return done(
      upstream.status,
      new NextResponse(text, {
        status: upstream.status,
        headers: {
          "Content-Type":
            upstream.headers.get("content-type") ?? "application/json",
          ...correlationHeaders(ctx),
        },
      }),
    );
  } catch {
    return done(
      502,
      NextResponse.json(
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
      ),
    );
  }
}
