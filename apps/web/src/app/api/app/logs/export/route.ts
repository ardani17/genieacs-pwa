import { NextResponse } from "next/server";
import { nativeCookieFrom, engineFetch } from "@/server/genieacs-client";
import { buildLogQuery, LogQueryError } from "@contracts/log-query";

export const dynamic = "force-dynamic";

// Log export: permission logs:3 enforced by the engine; capped at
// 10000 records / 50MiB / 30s upstream. NDJSON stream, not an envelope.
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
        requestId: "logs-export",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const q = buildLogQuery({ ...body, limit: 10000 } as never);
    const upstream = await engineFetch("/api/app/logs/export", {
      method: "POST",
      cookie,
      body: JSON.stringify(q),
      timeoutMs: 32_000,
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
          requestId: "logs-export",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
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
          requestId: "logs-export",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    const data = await upstream.arrayBuffer();
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": 'attachment; filename="logs-export.ndjson"',
        "Cache-Control": "no-store",
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
          requestId: "logs-export",
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
        requestId: "logs-export",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
