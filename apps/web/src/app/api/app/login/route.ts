import { NextResponse } from "next/server";
import {
  engineFetch,
  requireSameOrigin,
  clientIpForRateLimit,
  APP_COOKIE_NAME,
} from "../../../../server/genieacs-client";
import {
  requestContextFrom,
  observeRequest,
  correlationHeaders,
  type RequestContext,
} from "../../../../server/request-context";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

// In-memory failed-login limiter: 10 failures per (ip, username) per 15
// minutes. Single-process bound; the deployment runs one web instance.
// The ip part comes from clientIpForRateLimit: client-supplied
// X-Forwarded-For is discarded unless the deployment configured trusted
// proxy hops, so rotating the header cannot open fresh buckets.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; windowStart: number }>();

function limitStatus(key: string): {
  limited: boolean;
  retryAfterSeconds: number;
} {
  const entry = failures.get(key);
  if (!entry) return { limited: false, retryAfterSeconds: 0 };
  const elapsed = Date.now() - entry.windowStart;
  if (elapsed > WINDOW_MS) {
    failures.delete(key);
    return { limited: false, retryAfterSeconds: 0 };
  }
  return {
    limited: entry.count >= MAX_FAILURES,
    retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)),
  };
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS)
    failures.set(key, { count: 1, windowStart: now });
  else entry.count += 1;
}

// Every exit observes the request (correlated event in the app log
// volume) and echoes the request id; status text only — never
// credentials.
function respond(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
  actor?: string,
): NextResponse {
  observeRequest(
    ctx,
    status < 400 ? "success" : status < 500 ? "failure" : "partial",
    `login ${status}`,
    actor,
  );
  return NextResponse.json(
    { ...payload, requestId: ctx.requestId },
    { status, headers: { ...correlationHeaders(ctx), ...extraHeaders } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);

  const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
  if (!sameOrigin.ok)
    return respond(
      ctx,
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Cross-origin request rejected",
          retryable: false,
        },
      },
      403,
    );

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return respond(
      ctx,
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Malformed body",
          retryable: false,
        },
      },
      400,
    );
  }

  const ip = clientIpForRateLimit(request);
  const limitKey = `${ip}|${body.username ?? ""}`;
  const limit = limitStatus(limitKey);
  if (limit.limited)
    return respond(
      ctx,
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many failed attempts; try again later",
          retryable: true,
        },
      },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );

  let upstream: Response;
  try {
    upstream = await engineFetch("/login", {
      method: "POST",
      requestId: ctx.requestId,
      body: JSON.stringify({
        username: body.username ?? "",
        password: body.password ?? "",
      }),
    });
  } catch {
    return respond(
      ctx,
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
      },
      502,
    );
  }

  if (!upstream.ok) {
    recordFailure(limitKey);
    return respond(
      ctx,
      {
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Incorrect username or password",
          retryable: false,
        },
      },
      401,
    );
  }

  // Store the NATIVE session JWT in the BFF cookie: HttpOnly, Lax,
  // Secure when the public origin is https, 8h absolute.
  const setCookie = upstream.headers.get("set-cookie") ?? "";
  const token = /genieacs-ui-jwt=([^;]+)/.exec(setCookie)?.[1];
  if (!token)
    return respond(
      ctx,
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
      },
      502,
    );

  const secure = PUBLIC_ORIGIN.startsWith("https://");
  return respond(
    ctx,
    { ok: true, data: { authenticated: true } },
    200,
    {
      "Set-Cookie": `${APP_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`,
    },
    body.username,
  );
}
