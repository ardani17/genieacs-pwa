import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import {
  isBffResource,
  CSV_ROW_CAP,
  DEVICES_CSV_COLUMNS,
} from "@contracts/resources.ts";
import {
  deviceFilterWithSearch,
  AdapterError,
} from "@/server/resource-adapter";

export const dynamic = "force-dynamic";

// CSV export: a no-store STREAM (not a JSON envelope) mapped to the
// native /api/devices.csv endpoint with the SAME filter/search criteria
// as the list. Devices-only with the FIXED column allowlist from the
// contracts package — clients never choose export expressions, so a
// custom column can never steer the export onto a secret parameter.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ resource: string }> },
): Promise<NextResponse> {
  const { resource } = await ctx.params;
  if (!isBffResource(resource))
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Unknown resource",
          retryable: false,
        },
        requestId: "csv",
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  if (resource !== "devices")
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "CSV export is only available for devices",
          retryable: false,
        },
        requestId: "csv",
      },
      { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } },
    );

  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Not authenticated",
          retryable: false,
        },
        requestId: "csv",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );

  const url = new URL(request.url);
  let filter: string | null = null;
  try {
    filter = deviceFilterWithSearch(
      url.searchParams.get("search"),
      url.searchParams.get("filter"),
    );
  } catch (err) {
    if (!(err instanceof AdapterError)) throw err;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "invalid filter or search expression",
          retryable: false,
        },
        requestId: "csv",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const params = new URLSearchParams();
  if (filter) params.set("filter", filter);
  params.set("limit", String(CSV_ROW_CAP));
  params.set("columns", JSON.stringify(DEVICES_CSV_COLUMNS));

  try {
    const upstream = await engineFetch(
      `/api/${encodeURIComponent(resource)}.csv?${params}`,
      { cookie },
    );
    if (!upstream.ok)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code:
              upstream.status === 403
                ? "FORBIDDEN"
                : upstream.status === 401
                  ? "UNAUTHENTICATED"
                  : "BACKEND_UNAVAILABLE",
            message: "Request rejected",
            retryable: upstream.status >= 500,
          },
          requestId: "csv",
        },
        { status: upstream.status, headers: { "Cache-Control": "no-store" } },
      );

    // Stream through with native content-type/disposition preserved;
    // no-store; status preserved.
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "text/csv; charset=utf-8",
        ...(upstream.headers.get("content-disposition")
          ? {
              "Content-Disposition": sanitizeDisposition(
                upstream.headers.get("content-disposition") as string,
              ),
            }
          : {}),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Upstream unavailable",
          retryable: true,
        },
        requestId: "csv",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// Only filename tokens survive the content-disposition passthrough.
function sanitizeDisposition(value: string): string {
  const match = /filename="?([^";\r\n]+)"?/i.exec(value);
  const name = match?.[1] ?? "export.csv";
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${safe}"`;
}
