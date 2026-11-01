import { NextResponse } from "next/server";
import {
  engineFetch,
  requireSameOrigin,
} from "../../../../server/genieacs-client";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";
const APP_COOKIE = "app-session";

// In-memory failed-login limiter: 10 failures per (ip, username) per 15
// minutes. Single-process bound; the deployment runs one web instance.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; windowStart: number }>();

function tooManyFailedAttempts(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS)
    failures.set(key, { count: 1, windowStart: now });
  else entry.count += 1;
}

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
        requestId: "login",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );

  let body: { username?: string; password?: string };
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
        requestId: "login",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limitKey = `${ip}|${body.username ?? ""}`;
  if (tooManyFailedAttempts(limitKey))
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many failed attempts; try again later",
          retryable: true,
        },
        requestId: "login",
      },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );

  let upstream: Response;
  try {
    upstream = await engineFetch("/login", {
      method: "POST",
      body: JSON.stringify({
        username: body.username ?? "",
        password: body.password ?? "",
      }),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
        requestId: "login",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!upstream.ok) {
    recordFailure(limitKey);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Incorrect username or password",
          retryable: false,
        },
        requestId: "login",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Store the NATIVE session JWT in the BFF cookie: HttpOnly, Lax,
  // Secure when the public origin is https, 8h absolute.
  const setCookie = upstream.headers.get("set-cookie") ?? "";
  const token = /genieacs-ui-jwt=([^;]+)/.exec(setCookie)?.[1];
  if (!token)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
        requestId: "login",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );

  const secure = PUBLIC_ORIGIN.startsWith("https://");
  const response = NextResponse.json(
    { ok: true, data: { authenticated: true }, requestId: "login" },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${APP_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`,
      },
    },
  );
  return response;
}
