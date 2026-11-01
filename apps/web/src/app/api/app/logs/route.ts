import { NextResponse } from "next/server";
import { nativeCookieFrom, engineFetch } from "@/server/genieacs-client";
import { buildLogQuery, LogQueryError } from "@contracts/log-query";

export const dynamic = "force-dynamic";

// Log search proxy: the ENGINE authorizes (logs:3) and executes the
// bounded query; the BFF never builds VictoriaLogs URLs from raw input.
export async function POST(request: Request): Promise<NextResponse> {
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
        requestId: "logs",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  let body: Record<string, unknown>;
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
        requestId: "logs",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const q = buildLogQuery(body as never);
    const upstream = await engineFetch("/api/app/logs", {
      method: "POST",
      cookie,
      body: JSON.stringify(q),
      timeoutMs: 6000,
    });
    if (upstream.status === 403)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "No log access",
            retryable: false,
          },
          requestId: "logs",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    if (upstream.status === 401)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Not authenticated",
            retryable: false,
          },
          requestId: "logs",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BACKEND_UNAVAILABLE",
            message: "Log store unavailable",
            retryable: true,
          },
          requestId: "logs",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Request-Id": "logs",
      },
    });
  } catch (err) {
    if (err instanceof LogQueryError === true)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: (err as Error).message,
            retryable: false,
          },
          requestId: "logs",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Log store unavailable",
          retryable: true,
        },
        requestId: "logs",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
