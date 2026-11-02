import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import { isBffResource, verbAllowed } from "@contracts/resources.ts";
import {
  normalizeListQuery,
  toNativeParams,
  deviceFilterWithSearch,
  AdapterError,
} from "@/server/resource-adapter";
import { maskDeviceForUi } from "@/server/mask-device";
import {
  requestContextFrom,
  observeRequest,
  correlationHeaders,
  type RequestContext,
} from "@/server/request-context";

export const dynamic = "force-dynamic";

const STATUS_TO_CODE: Record<number, string> = {
  400: "VALIDATION",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  503: "BACKEND_UNAVAILABLE",
};

function errorEnvelope(status: number, ctx: RequestContext): NextResponse {
  const code = STATUS_TO_CODE[status] ?? "INTERNAL";
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message: status >= 500 ? "Upstream unavailable" : "Request rejected",
        retryable: status >= 500 || status === 429,
      },
      requestId: ctx.requestId,
    },
    { status, headers: correlationHeaders(ctx) },
  );
}

function validationError(message: string, ctx: RequestContext): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code: "VALIDATION", message, retryable: false },
      requestId: ctx.requestId,
    },
    { status: 400, headers: correlationHeaders(ctx) },
  );
}

// The SAME filter string for the page, the count and the CSV export:
// explicit filter (validated by the native parser) ANDed with the
// search AST when one is present.
function combinedFilter(resource: string, url: URL): string | null {
  if (resource !== "devices") {
    const raw = url.searchParams.get("filter");
    return raw && raw.length <= 8192 ? raw : null;
  }
  try {
    return deviceFilterWithSearch(
      url.searchParams.get("search"),
      url.searchParams.get("filter"),
    );
  } catch (err) {
    if (err instanceof AdapterError) return null;
    throw err;
  }
}

async function handle(
  request: Request,
  resource: string,
  verb: "GET",
): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  if (!isBffResource(resource)) return errorEnvelope(404, ctx);
  if (!verbAllowed(resource, verb))
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Method not allowed",
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      {
        status: 405,
        headers: { Allow: "GET", ...correlationHeaders(ctx) },
      },
    );

  const url = new URL(request.url);
  const filter = combinedFilter(resource, url);
  if (filter === null && url.searchParams.get("filter"))
    return validationError(
      resource === "devices" && url.searchParams.get("search")
        ? "invalid filter or search expression"
        : "invalid filter expression",
      ctx,
    );

  let normalized;
  try {
    normalized = normalizeListQuery(
      {
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
        filter: filter ?? undefined,
        projection: url.searchParams.get("projection") ?? undefined,
      },
      resource,
    );
  } catch (err) {
    const message =
      err instanceof AdapterError || err instanceof Error
        ? err.message
        : "invalid query";
    return validationError(message, ctx);
  }

  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return errorEnvelope(401, ctx);

  const params = toNativeParams(normalized);

  try {
    const upstream = await engineFetch(
      `/api/${encodeURIComponent(resource)}?${params}`,
      { cookie, requestId: ctx.requestId },
    );
    if (!upstream.ok) return errorEnvelope(upstream.status, ctx);

    // Total from a same-filter HEAD (native exposes X-Total-Count); a
    // 403 on count means "no count permission" => total stays null.
    let total: number | null = null;
    try {
      const countParams = new URLSearchParams();
      if (normalized.filter) countParams.set("filter", normalized.filter);
      const head = await engineFetch(
        `/api/${encodeURIComponent(resource)}?${countParams}`,
        { method: "HEAD", cookie, requestId: ctx.requestId },
      );
      const countHeader = head.headers.get("x-total-count");
      if (head.ok && countHeader !== null) total = Number(countHeader);
    } catch {
      total = null;
    }

    const items = (await upstream.json()) as unknown[];
    const masked =
      resource === "devices"
        ? items.map((d) => maskDeviceForUi(d as never))
        : items;

    observeRequest(ctx, "success", `list ${resource} 200`);
    return NextResponse.json(
      {
        ok: true,
        data: {
          items: masked,
          total,
          page: normalized.page,
          pageSize: normalized.pageSize,
          hasNext:
            total === null
              ? items.length === normalized.limit
              : normalized.skip + items.length < total,
          observedAt: new Date().toISOString(),
          source: "live",
        },
        requestId: ctx.requestId,
      },
      { headers: correlationHeaders(ctx) },
    );
  } catch {
    return errorEnvelope(502, ctx);
  }
}

// Count contract: an explicit HEAD returns the permission-filtered
// X-Total-Count for the SAME filter/search criteria as the list —
// without materializing a page. Denied counts surface as 403 so the
// caller can render total=null rather than a wrong number.
export async function HEAD(
  request: Request,
  ctx: { params: Promise<{ resource: string }> },
): Promise<NextResponse> {
  const { resource } = await ctx.params;
  const reqCtx = requestContextFrom(request);
  if (!isBffResource(resource))
    return new NextResponse(null, {
      status: 404,
      headers: correlationHeaders(reqCtx),
    });
  if (!verbAllowed(resource, "GET"))
    return new NextResponse(null, {
      status: 405,
      headers: { Allow: "GET", ...correlationHeaders(reqCtx) },
    });

  const url = new URL(request.url);
  const filter = combinedFilter(resource, url);
  if (filter === null && url.searchParams.get("filter"))
    return new NextResponse(null, {
      status: 400,
      headers: correlationHeaders(reqCtx),
    });

  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie)
    return new NextResponse(null, {
      status: 401,
      headers: correlationHeaders(reqCtx),
    });

  const params = new URLSearchParams();
  if (filter) params.set("filter", filter);
  try {
    const head = await engineFetch(
      `/api/${encodeURIComponent(resource)}?${params}`,
      { method: "HEAD", cookie, requestId: reqCtx.requestId },
    );
    const countHeader = head.headers.get("x-total-count");
    observeRequest(
      reqCtx,
      head.ok ? "success" : head.status < 500 ? "failure" : "partial",
      `count ${resource} ${head.status}`,
    );
    return new NextResponse(null, {
      status: head.status,
      headers: {
        ...correlationHeaders(reqCtx),
        ...(head.ok && countHeader !== null
          ? { "X-Total-Count": countHeader }
          : {}),
      },
    });
  } catch {
    return new NextResponse(null, {
      status: 502,
      headers: correlationHeaders(reqCtx),
    });
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ resource: string }> },
): Promise<NextResponse> {
  const { resource } = await ctx.params;
  return handle(request, resource, "GET");
}
