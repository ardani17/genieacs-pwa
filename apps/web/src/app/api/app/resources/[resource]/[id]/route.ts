import { NextResponse } from "next/server";
import {
  engineFetch,
  nativeCookieFrom,
  requireSameOrigin,
} from "@/server/genieacs-client";
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

function errorEnvelope(status: number): NextResponse {
  const code = STATUS_TO_CODE[status] ?? "INTERNAL";
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message: status >= 500 ? "Upstream unavailable" : "Request rejected",
        retryable: status >= 500 || status === 429,
      },
      requestId: "resource-item",
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function proxy(
  request: Request,
  resource: string,
  id: string,
  verb: "GET" | "PUT" | "DELETE",
): Promise<NextResponse> {
  if (!isBffResource(resource)) return errorEnvelope(404);
  if (!verbAllowed(resource, verb))
    return new NextResponse(null, {
      status: 405,
      headers: {
        Allow: BFF_ALLOW[resource].join(", "),
        "Cache-Control": "no-store",
      },
    });

  // Mutations run the SAME guard as every other state-changing app
  // route: same-origin + X-App-Request, BEFORE the body is read or
  // the upstream is contacted (contracts.md mutation rules).
  if (verb !== "GET") {
    const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
    if (!sameOrigin.ok) return errorEnvelope(403);
  }

  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return errorEnvelope(401);

  // IDs are encodeURIComponent'd exactly once — never concatenated into
  // the path or query raw.
  const path = `/api/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`;

  try {
    const upstream = await engineFetch(path, {
      method: verb,
      cookie,
      body: verb === "PUT" ? await request.text() : undefined,
    });
    if (verb === "DELETE" && upstream.status === 200)
      return NextResponse.json(
        { ok: true, data: { deleted: true }, requestId: "resource-item" },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (verb === "PUT" && (upstream.status === 200 || upstream.status === 204))
      return NextResponse.json(
        { ok: true, data: { saved: true }, requestId: "resource-item" },
        { headers: { "Cache-Control": "no-store" } },
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
        { ok: true, data, requestId: "resource-item" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return errorEnvelope(upstream.status);
  } catch {
    return errorEnvelope(502);
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
