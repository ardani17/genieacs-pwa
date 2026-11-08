import { NextResponse } from "next/server";
import {
  nativeCookieFrom,
  engineFetch,
  requireSameOrigin,
} from "./genieacs-client";
import { correlationHeaders, requestContextFrom } from "./request-context";

export async function vpnAction(
  request: Request,
  action: "reconnect" | "diagnose" | "reset-bootstrap",
): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const fail = (status: number, code: string, message: string): NextResponse =>
    NextResponse.json(
      {
        ok: false,
        error: { code, message, retryable: status >= 500 },
        requestId: ctx.requestId,
      },
      { status, headers: correlationHeaders(ctx) },
    );
  if (
    !requireSameOrigin(
      request,
      process.env.PUBLIC_ORIGIN ?? "http://localhost:3000",
    ).ok
  )
    return fail(403, "FORBIDDEN", "Permintaan ditolak (same-origin)");
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return fail(401, "UNAUTHENTICATED", "Sesi berakhir");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION", "Body harus JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return fail(400, "VALIDATION", "Body harus objek");
  const r = body as Record<string, unknown>;
  if (action === "reset-bootstrap") {
    if (
      Object.keys(r).some((k) => !["revision", "confirm"].includes(k)) ||
      r.confirm !== "RESET" ||
      typeof r.revision !== "number" ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 0 ||
      r.revision >= Number.MAX_SAFE_INTEGER
    )
      return fail(
        400,
        "VALIDATION",
        "Reset memerlukan RESET dan revision saat ini",
      );
  } else if (Object.keys(r).length)
    return fail(400, "VALIDATION", "Body harus kosong");
  try {
    const response = await engineFetch(`/api/app/vpn/${action}`, {
      method: "POST",
      cookie,
      requestId: ctx.requestId,
      body: JSON.stringify(body),
      timeoutMs: 15000,
    });
    if (response.status === 401 || response.status === 403)
      return fail(
        response.status,
        response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
        "Tidak ada izin untuk tindakan ini",
      );
    const payload = await response.json();
    return NextResponse.json(
      { ...payload, requestId: ctx.requestId },
      { status: response.status, headers: correlationHeaders(ctx) },
    );
  } catch {
    return fail(503, "VPN_UNAVAILABLE", "Layanan VPN tidak terjangkau");
  }
}
