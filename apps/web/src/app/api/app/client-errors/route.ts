import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
} from "@/server/genieacs-client";
import { getAppLogger } from "@/server/logger";
import {
  requestContextFrom,
  observeRequest,
  correlationHeaders,
  type RequestContext,
} from "@/server/request-context";

export const dynamic = "force-dynamic";

// Client error sink for LOGGED-IN users: same-origin mutation guard,
// the actor resolved server-side from a verified native session (never
// from client ids), only allowlisted fields, body capped at 16KiB and
// 10 events per minute PER USER (one noisy user cannot spend another
// user's quota).
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";
const BODY_MAX = 16 * 1024;
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;
const rate = new Map<string, { count: number; windowStart: number }>();

function errorResponse(
  ctx: RequestContext,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  extraHeaders?: Record<string, string>,
): NextResponse {
  observeRequest(
    ctx,
    status < 400 ? "success" : status < 500 ? "failure" : "partial",
    `client-errors ${status}`,
  );
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable },
      requestId: ctx.requestId,
    },
    {
      status,
      headers: { ...correlationHeaders(ctx), ...extraHeaders },
    },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  // Same-origin mutation guard first: anonymous and forged requests
  // never reach the quota or the sink.
  const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
  if (!sameOrigin.ok)
    return errorResponse(
      ctx,
      403,
      "FORBIDDEN",
      "Cross-origin request rejected",
      false,
    );

  // A REAL session decides the actor: the native token is verified by
  // the engine, and the username comes from the session DTO — a cookie
  // that merely looks like a session is still anonymous here.
  const token = nativeCookieFrom(request.headers.get("cookie"));
  if (!token)
    return errorResponse(
      ctx,
      401,
      "UNAUTHENTICATED",
      "Not authenticated",
      false,
    );

  let username: string;
  try {
    const upstream = await engineFetch("/api/session", {
      cookie: token,
      requestId: ctx.requestId,
      timeoutMs: 5000,
    });
    if (!upstream.ok)
      return errorResponse(
        ctx,
        401,
        "UNAUTHENTICATED",
        "Not authenticated",
        false,
      );
    const session = (await upstream.json()) as { username?: unknown };
    if (typeof session.username !== "string" || !session.username)
      return errorResponse(
        ctx,
        401,
        "UNAUTHENTICATED",
        "Not authenticated",
        false,
      );
    username = session.username;
  } catch {
    return errorResponse(
      ctx,
      502,
      "BACKEND_UNAVAILABLE",
      "Backend unavailable",
      true,
    );
  }

  const raw = await request.text();
  if (raw.length > BODY_MAX)
    return errorResponse(ctx, 413, "VALIDATION", "Body too large", false);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse(ctx, 400, "VALIDATION", "Malformed body", false);
  }

  const allowed = new Set(["event", "message", "stack", "location"]);
  for (const key of Object.keys(parsed))
    if (!allowed.has(key))
      return errorResponse(
        ctx,
        400,
        "VALIDATION",
        `Unknown field ${key}`,
        false,
      );

  // Per-USER quota keyed by the verified actor.
  const now = Date.now();
  const entry = rate.get(username);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS)
    rate.set(username, { count: 1, windowStart: now });
  else if (entry.count >= RATE_MAX)
    return errorResponse(ctx, 429, "RATE_LIMITED", "Too many reports", true, {
      "Retry-After": String(
        Math.max(
          1,
          Math.ceil((RATE_WINDOW_MS - (now - entry.windowStart)) / 1000),
        ),
      ),
    });
  else entry.count += 1;

  getAppLogger().emit({
    event: "web.client.error",
    level: "warn",
    actorId: username,
    requestId: ctx.requestId,
    message: String(parsed.message ?? parsed.event ?? "client error").slice(
      0,
      500,
    ),
    details: {
      event: String(parsed.event ?? "").slice(0, 128),
      stack: String(parsed.stack ?? "").slice(0, 4000),
      location: String(parsed.location ?? "").slice(0, 500),
    },
  });

  observeRequest(ctx, "success", "client-error reported", username);
  return NextResponse.json(
    { ok: true, data: { accepted: true }, requestId: ctx.requestId },
    { headers: correlationHeaders(ctx) },
  );
}
