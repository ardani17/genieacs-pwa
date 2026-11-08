import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";
import { getAppLogger } from "@/server/logger";
export const dynamic = "force-dynamic";
let webDegradedSince: string | null = null;
export async function GET(request: Request) {
  const ctx = requestContextFrom(request),
    cookie = nativeCookieFrom(request.headers.get("cookie"));
  const error = (status: number, code: string) =>
    NextResponse.json(
      {
        ok: false,
        error: {
          code,
          message: "Status logging tidak tersedia",
          retryable: status >= 500,
        },
        requestId: ctx.requestId,
      },
      { status, headers: correlationHeaders(ctx) },
    );
  if (!cookie) return error(401, "UNAUTHENTICATED");
  try {
    const response = await engineFetch("/api/app/logs/status", {
      cookie,
      requestId: ctx.requestId,
      timeoutMs: 5000,
    });
    if (!response.ok)
      return error(
        response.status,
        response.status === 403 ? "FORBIDDEN" : "LOGGING_DEGRADED",
      );
    const result = await response.json();
    const web = getAppLogger().status();
    if (web.state === "degraded") webDegradedSince ??= new Date().toISOString();
    else webDegradedSince = null;
    return NextResponse.json(
      {
        ...result,
        data: {
          ...result.data,
          web,
          state: web.state === "degraded" ? "degraded" : result.data.state,
          degradedSince: webDegradedSince ?? result.data.degradedSince,
          droppedEvents: result.data.droppedEvents + web.droppedEvents,
        },
        requestId: ctx.requestId,
      },
      { headers: correlationHeaders(ctx) },
    );
  } catch {
    return error(503, "LOGGING_DEGRADED");
  }
}
