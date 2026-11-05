import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
} from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

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
  const body = await request.text();
  try {
    const upstream = await engineFetch("/api/app/admin/users", {
      method: "POST",
      body,
      cookie,
      requestId: ctx.requestId,
      timeoutMs: 15_000,
    });
    const data = await upstream.json().catch(() => null);
    if (data && typeof data === "object" && "ok" in data)
      return NextResponse.json(
        { ...data, requestId: ctx.requestId },
        { status: upstream.status, headers: correlationHeaders(ctx) },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL",
          message: "Respon tidak valid",
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
          code: "TIMEOUT",
          message: "Kebihabisan waktu",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 504, headers: correlationHeaders(ctx) },
    );
  }
}
