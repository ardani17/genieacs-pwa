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
// The key embeds the client-supplied username, so the map is only as
// bounded as the input: cap both parts. Keys longer than this share a
// bucket (usernames are short by nature), and the map itself is pruned
// so an unauthenticated spray of distinct usernames cannot grow the
// long-lived process without limit.
const KEY_USERNAME_MAX = 128;
const MAX_TRACKED_KEYS = 8192;
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

function pruneTrackedKeys(now: number): void {
  // Drop expired entries first; if the window is still full of live
  // keys, evict the oldest window so the bound holds regardless.
  if (failures.size < MAX_TRACKED_KEYS) return;
  for (const [k, entry] of failures)
    if (now - entry.windowStart > WINDOW_MS) failures.delete(k);
  while (failures.size >= MAX_TRACKED_KEYS) {
    let oldest: string | null = null;
    let oldestStart = Infinity;
    for (const [k, entry] of failures)
      if (entry.windowStart < oldestStart) {
        oldestStart = entry.windowStart;
        oldest = k;
      }
    if (oldest == null) break;
    failures.delete(oldest);
  }
}

function recordFailure(key: string): void {
  const now = Date.now();
  pruneTrackedKeys(now);
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
    // Bound the payload before parsing (route handlers have no
    // built-in cap): a login body is a few hundred bytes at most, and
    // the limiter key is derived from the parsed username.
    const raw = await request.text();
    if (raw.length > 4096) throw new Error("body too large");
    body = JSON.parse(raw);
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
  const username = String(body.username ?? "").slice(0, KEY_USERNAME_MAX);
  const limitKey = `${ip}|${username}`;
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
    // Only the engine's own credential rejection (400) counts as a
    // failed attempt and maps to 401. Other statuses — 500 when the
    // engine secret is unset, 502/503 under load — are backend
    // faults: masking them as "incorrect password" racks up limiter
    // strikes and locks users out of a healthy-credential login
    // during an outage, and monitoring never sees a 5xx.
    if (upstream.status !== 400) {
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
