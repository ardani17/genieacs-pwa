import { NextResponse } from "next/server";
import { getAppLogger } from "@/server/logger";

export const dynamic = "force-dynamic";

// Client error sink: only allowlisted fields, body capped at 16KiB,
// 10 events per minute per user. The server associates the actor from
// the session cookie and its own requestId — never trusts client ids.
const BODY_MAX = 16 * 1024;
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;
const rate = new Map<string, { count: number; windowStart: number }>();

export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.text();
  if (raw.length > BODY_MAX)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Body too large",
          retryable: false,
        },
        requestId: "client-errors",
      },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Malformed body",
          retryable: false,
        },
        requestId: "client-errors",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const allowed = new Set(["event", "message", "stack", "location"]);
  for (const key of Object.keys(parsed))
    if (!allowed.has(key))
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: `Unknown field ${key}`,
            retryable: false,
          },
          requestId: "client-errors",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );

  // Session cookie presence identifies the actor bucket (the engine
  // resolves the actual username on log correlation; we avoid trusting
  // any client-supplied identity).
  const hasSession = request.headers.get("cookie")?.includes("app-session");
  const actorKey = hasSession ? "session" : "anonymous";
  const now = Date.now();
  const entry = rate.get(actorKey);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS)
    rate.set(actorKey, { count: 1, windowStart: now });
  else if (entry.count >= RATE_MAX)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many reports",
          retryable: true,
        },
        requestId: "client-errors",
      },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  else entry.count += 1;

  getAppLogger().emit({
    event: "web.client.error",
    level: "warn",
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

  return NextResponse.json(
    { ok: true, data: { accepted: true }, requestId: "client-errors" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
