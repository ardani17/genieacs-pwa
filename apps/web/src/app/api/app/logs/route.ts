import { NextResponse } from "next/server";
import {
  nativeCookieFrom,
  engineFetch,
  requireSameOrigin,
} from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";
import { buildLogQuery, LogQueryError } from "@contracts/log-query";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

// Log search proxy: the ENGINE authorizes (logs:3) and executes the
// bounded query; the BFF never builds VictoriaLogs URLs from raw input.
export async function POST(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);

  // Contracts.md mutation rules: same-origin + X-App-Request on every
  // state-changing route, checked BEFORE the body is read or the
  // upstream is contacted.
  const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
  if (!sameOrigin.ok)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Permintaan ditolak (same-origin)",
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
        requestId: ctx.requestId,
      },
      { status: 400, headers: correlationHeaders(ctx) },
    );
  }

  try {
    const q = buildLogQuery(body as never);
    const upstream = await engineFetch("/api/app/logs", {
      method: "POST",
      cookie,
      requestId: ctx.requestId,
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
          requestId: ctx.requestId,
        },
        { status: 403, headers: correlationHeaders(ctx) },
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
          requestId: ctx.requestId,
        },
        { status: 401, headers: correlationHeaders(ctx) },
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
          requestId: ctx.requestId,
        },
        { status: 503, headers: correlationHeaders(ctx) },
      );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        ...correlationHeaders(ctx),
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
          requestId: ctx.requestId,
        },
        { status: 400, headers: correlationHeaders(ctx) },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Log store unavailable",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 503, headers: correlationHeaders(ctx) },
    );
  }
}
