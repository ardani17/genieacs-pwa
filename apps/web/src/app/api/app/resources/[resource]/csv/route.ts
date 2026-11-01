import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import { isBffResource, CSV_ROW_CAP } from "@contracts/resources.ts";

export const dynamic = "force-dynamic";

// CSV export: a no-store STREAM (not a JSON envelope) mapped to the
// native /api/:resource.csv endpoint with the same filter, capped rows.
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
  const params = new URLSearchParams();
  const filter = url.searchParams.get("filter");
  if (filter && filter.length <= 8192) params.set("filter", filter);
  params.set("limit", String(CSV_ROW_CAP));
  if (url.searchParams.get("columns")) {
    const columns = url.searchParams.get("columns") ?? "";
    if (columns.length <= 8192) params.set("columns", columns);
  }

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
