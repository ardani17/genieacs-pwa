import { NextResponse } from "next/server";
import {
  correlationHeaders,
  requestContextFrom,
} from "@/server/request-context";

// Web health: stays 200 while the VPN is down or the backend is
// unreachable — it reports backend reachability as data, never as an
// outage of the dashboard itself. Uses the engine's native /status with
// a 2s budget; no-store; safe fields only.
export const dynamic = "force-dynamic";

const ENGINE_STATUS_URL =
  process.env.ENGINE_STATUS_URL ?? "http://ui:7583/status";

export async function GET(request: Request) {
  const ctx = requestContextFrom(request);
  let backendReachable = false;
  try {
    const response = await fetch(ENGINE_STATUS_URL, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    backendReachable = response.ok;
  } catch {
    backendReachable = false;
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        web: true,
        backendReachable,
        observedAt: new Date().toISOString(),
      },
      requestId: ctx.requestId,
    },
    { headers: correlationHeaders(ctx) },
  );
}
