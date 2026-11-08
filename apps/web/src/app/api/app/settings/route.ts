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
import { validateVpnProfileInput } from "@contracts/settings";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

// Saved installation settings (VPN/ACS profile). The ENGINE authorizes
// (vpn:3, contracts.md API table) and owns the revision CAS + secretbox;
// the BFF only forwards the session cookie. It NEVER proxies the
// /api/internal/* service endpoints (controller/ACS-address tokens).

function unauthenticated(requestId: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Not authenticated",
        retryable: false,
      },
      requestId,
    },
    {
      status: 401,
      headers: correlationHeaders({ requestId, startedAt: Date.now() }),
    },
  );
}

/** The engine already answers in the ApiResult envelope (including
 * fieldErrors and its own echoed requestId) — pass it through verbatim. */
async function forwardUpstream(
  upstream: Response,
  requestId: string,
): Promise<NextResponse> {
  if (upstream.status === 401 || upstream.status === 403)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: upstream.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
          message: "Tidak ada izin mengelola settings",
          retryable: false,
        },
        requestId,
      },
      {
        status: upstream.status,
        headers: correlationHeaders({ requestId, startedAt: Date.now() }),
      },
    );
  const text = await upstream.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = {
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Settings backend unavailable",
        retryable: true,
      },
      requestId,
    };
  }
  return NextResponse.json(body, {
    status: upstream.status,
    headers: correlationHeaders({ requestId, startedAt: Date.now() }),
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return unauthenticated(ctx.requestId);

  try {
    const upstream = await engineFetch("/api/app/settings", {
      cookie,
      requestId: ctx.requestId,
      timeoutMs: 5000,
    });
    return await forwardUpstream(upstream, ctx.requestId);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Settings backend unavailable",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 503, headers: correlationHeaders(ctx) },
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);

  // Contracts.md mutation rules: same-origin check BEFORE the body is
  // read or the upstream is contacted.
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
  if (!cookie) return unauthenticated(ctx.requestId);

  let body: unknown;
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

  // Local pre-validation mirrors the engine (the authority); the RAW body
  // still travels upstream so the two validators can never diverge in
  // what actually gets persisted.
  const validation = validateVpnProfileInput(body);
  if (validation.ok === false)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Profil settings tidak valid",
          fieldErrors: validation.fieldErrors,
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      { status: 400, headers: correlationHeaders(ctx) },
    );

  try {
    const upstream = await engineFetch("/api/app/settings", {
      method: "PUT",
      cookie,
      requestId: ctx.requestId,
      body: JSON.stringify(body),
      timeoutMs: 8000,
    });
    return await forwardUpstream(upstream, ctx.requestId);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Settings backend unavailable",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 503, headers: correlationHeaders(ctx) },
    );
  }
}
