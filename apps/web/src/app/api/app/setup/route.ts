import { NextResponse } from "next/server";
import { engineFetch, requireSameOrigin } from "@/server/genieacs-client";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

// Setup status/installer: maps the NATIVE /init flow. GET reports
// whether the installer path is available (no users yet) via the native
// /init status; POST creates the initial admin only in that state.
export async function GET(): Promise<NextResponse> {
  try {
    const upstream = await engineFetch("/init", { timeoutMs: 5000 });
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BACKEND_UNAVAILABLE",
            message: "Backend unavailable",
            retryable: true,
          },
          requestId: "setup",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    const status = (await upstream.json()) as Record<string, unknown>;
    const available = status["users"] !== false;
    return NextResponse.json(
      { ok: true, data: { available }, requestId: "setup" },
      { headers: { "Cache-Control": "no-store" } },
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
        requestId: "setup",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
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
        requestId: "setup",
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
        requestId: "setup",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );

  try {
    const statusRes = await engineFetch("/init", { timeoutMs: 5000 });
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
          requestId: "setup",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );

    const upstream = await engineFetch("/init", {
      method: "POST",
      body: JSON.stringify({ users: true, adminPassword: body.password }),
    });
    if (upstream.ok)
      return NextResponse.json(
        { ok: true, data: { created: true }, requestId: "setup" },
        { headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Gagal membuat admin",
          retryable: true,
        },
        requestId: "setup",
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
        requestId: "setup",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
