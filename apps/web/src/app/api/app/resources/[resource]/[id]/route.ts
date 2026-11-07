import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
} from "@/server/genieacs-client";
import {
  correlationHeaders,
  requestContextFrom,
  type RequestContext,
} from "@/server/request-context";
import { isBffResource, verbAllowed } from "@contracts/resources.ts";
import { maskDeviceForUi } from "@/server/mask-device";

export const dynamic = "force-dynamic";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

const STATUS_TO_CODE: Record<number, string> = {
  400: "VALIDATION",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  503: "BACKEND_UNAVAILABLE",
};

function errorEnvelope(status: number, reqCtx: RequestContext): NextResponse {
  const code = STATUS_TO_CODE[status] ?? "INTERNAL";
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message: status >= 500 ? "Upstream unavailable" : "Request rejected",
        retryable: status >= 500 || status === 429,
      },
      requestId: reqCtx.requestId,
    },
    { status, headers: correlationHeaders(reqCtx) },
  );
}

async function proxy(
  request: Request,
  resource: string,
  id: string,
  verb: "GET" | "PUT" | "DELETE",
): Promise<NextResponse> {
  const reqCtx = requestContextFrom(request);
  if (!isBffResource(resource)) return errorEnvelope(404, reqCtx);
  if (!verbAllowed(resource, verb))
    return new NextResponse(null, {
      status: 405,
      headers: {
        Allow: BFF_ALLOW[resource].join(", "),
        ...correlationHeaders(reqCtx),
      },
    });

  // Mutations run the SAME guard as every other state-changing app
  // route: same-origin + X-App-Request, BEFORE the body is read or
  // the upstream is contacted (contracts.md mutation rules).
  if (verb !== "GET") {
    const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
    if (!sameOrigin.ok) return errorEnvelope(403, reqCtx);
  }

  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return errorEnvelope(401, reqCtx);

  // IDs are encodeURIComponent'd exactly once — never concatenated into
  // the path or query raw.
  const path = `/api/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`;

  try {
    const upstream = await engineFetch(path, {
      method: verb,
      cookie,
      requestId: reqCtx.requestId,
      body: verb === "PUT" ? await request.text() : undefined,
      // Config secret reveal is a per-request EXPLICIT action the
      // engine authorizes (config:3 + header); the BFF only forwards
      // the fixed header name (M06-B).
      ...(verb === "GET" &&
      resource === "config" &&
      new URL(request.url).searchParams.get("reveal") === "1"
        ? { headers: { "X-Reveal-Secrets": "1" } }
        : {}),
    });
    if (verb === "DELETE" && upstream.status === 200)
      return NextResponse.json(
        { ok: true, data: { deleted: true }, requestId: reqCtx.requestId },
        { headers: correlationHeaders(reqCtx) },
      );
    if (verb === "PUT" && (upstream.status === 200 || upstream.status === 204))
      return NextResponse.json(
        { ok: true, data: { saved: true }, requestId: reqCtx.requestId },
        { headers: correlationHeaders(reqCtx) },
      );
    if (verb === "GET" && upstream.ok) {
      const item = await upstream.json();
      // The generic detail path applies the SAME secret policy as the
      // dedicated device detail: a raw device never crosses the BFF.
      const data =
        resource === "devices"
          ? maskDeviceForUi(item as Record<string, unknown>)
          : item;
      return NextResponse.json(
        { ok: true, data, requestId: reqCtx.requestId },
        { headers: correlationHeaders(reqCtx) },
      );
    }
    return errorEnvelope(upstream.status, reqCtx);
  } catch {
    return errorEnvelope(502, reqCtx);
  }
}

const BFF_ALLOW: Record<string, string[]> = {
  devices: ["GET", "DELETE"],
  tasks: ["GET"],
  faults: ["GET", "DELETE"],
  files: ["GET", "DELETE"],
  presets: ["GET", "PUT", "DELETE"],
  provisions: ["GET", "PUT", "DELETE"],
  virtualParameters: ["GET", "PUT", "DELETE"],
  config: ["GET", "PUT", "DELETE"],
  permissions: ["GET", "PUT", "DELETE"],
  users: ["GET", "PUT", "DELETE"],
};

export async function GET(
  request: Request,
  ctx: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await ctx.params;
  return proxy(request, resource, id, "GET");
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await ctx.params;
  return proxy(request, resource, id, "PUT");
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await ctx.params;
  return proxy(request, resource, id, "DELETE");
}
