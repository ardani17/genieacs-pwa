import { NextResponse } from "next/server";
import { engineFetch, requireSameOrigin } from "@/server/genieacs-client";
import { requestContextFrom, observeRequest } from "@/server/request-context";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

// Setup status/installer: maps the NATIVE /init flow. GET reports
// whether the installer path is available (no users yet) via the native
// /init status; POST creates the initial admin only in that state.
export async function GET(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  try {
    const upstream = await engineFetch("/init", {
      requestId: ctx.requestId,
      timeoutMs: 5000,
    });
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BACKEND_UNAVAILABLE",
            message: "Backend unavailable",
            retryable: true,
          },
          requestId: ctx.requestId,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    const status = (await upstream.json()) as Record<string, unknown>;
    const available = status["users"] !== false;
    observeRequest(ctx, "success", "setup status");
    return NextResponse.json(
      { ok: true, data: { available }, requestId: ctx.requestId },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": ctx.requestId,
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
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
        requestId: ctx.requestId,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (typeof body.password !== "string" || body.password.length < 8)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Password minimal 8 karakter",
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const statusRes = await engineFetch("/init", {
      requestId: ctx.requestId,
      timeoutMs: 5000,
    });
    const status = (await statusRes.json()) as Record<string, unknown>;
    if (status["users"] === false)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Instalasi sudah memiliki pengguna",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );

    // Native /init installer contract: users as {username, password,
    // roles[]} — the engine hashes the CHOSEN password with native
    // salt/pbkdf2 and seeds the admin permission set (including the
    // app-level vpn/logs grants) in the same call. admin/admin is never
    // created, so there is no default-credential window.
    const upstream = await engineFetch("/init", {
      method: "POST",
      requestId: ctx.requestId,
      body: JSON.stringify({
        users: [
          { username: "admin", password: body.password, roles: ["admin"] },
        ],
      }),
    });
    if (upstream.ok) {
      observeRequest(ctx, "success", "setup installed");
      return NextResponse.json(
        { ok: true, data: { created: true }, requestId: ctx.requestId },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Request-Id": ctx.requestId,
          },
        },
      );
    }
    if (upstream.status === 400)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "Payload admin ditolak oleh initializer",
            retryable: false,
          },
          requestId: ctx.requestId,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Gagal membuat admin",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Backend unavailable",
          retryable: true,
        },
        requestId: ctx.requestId,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
