import { NextResponse } from "next/server";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";
import { FILE_UPLOAD_MAX_BYTES } from "@contracts/resources.ts";

export const dynamic = "force-dynamic";

// File content: GET streams the native blob (status/type/disposition
// preserved, no envelope, no-store); PUT streams an octet-stream body up
// to 100MiB to the native upload endpoint with a metadata-header
// allowlist. The browser cancelling aborts the upstream request.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return unauthenticated();

  try {
    const upstream = await engineFetch(
      `/api/blob/files/${encodeURIComponent(id)}`,
      { cookie, timeoutMs: 30_000 },
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
                  : upstream.status === 404
                    ? "NOT_FOUND"
                    : "BACKEND_UNAVAILABLE",
            message: "Request rejected",
            retryable: upstream.status >= 500,
          },
          requestId: "file-content",
        },
        { status: upstream.status, headers: { "Cache-Control": "no-store" } },
      );

    const disposition = upstream.headers.get("content-disposition") ?? "";
    const name = /filename="?([^";\r\n]+)"?/i.exec(disposition)?.[1] ?? "file";
    const safeName = name.replace(/[^A-Za-z0-9._-]/g, "_");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
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
        requestId: "file-content",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

const METADATA_ALLOWLIST = [
  "metadata-filetype",
  "metadata-oui",
  "metadata-productclass",
  "metadata-version",
];

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return unauthenticated() as NextResponse;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > FILE_UPLOAD_MAX_BYTES)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "File exceeds 100MiB limit",
          retryable: false,
        },
        requestId: "file-upload",
      },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );

  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
  };
  for (const name of METADATA_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value) headers[name] = value.slice(0, 256);
  }

  try {
    const upstream = await fetch(
      `${process.env.GENIEACS_UI_URL ?? "http://ui:7583"}/api/files/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: {
          ...headers,
          Cookie: `genieacs-ui-jwt=${cookie}`,
        },
        body: request.body,
        // @ts-expect-error Node undici duplex streaming
        duplex: "half",
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (upstream.ok)
      return NextResponse.json(
        { ok: true, data: { uploaded: true }, requestId: "file-upload" },
        { headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: upstream.status === 403 ? "FORBIDDEN" : "BACKEND_UNAVAILABLE",
          message: "Upload rejected",
          retryable: upstream.status >= 500,
        },
        requestId: "file-upload",
      },
      {
        status: upstream.status === 403 ? 403 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "Upstream unavailable",
          retryable: true,
        },
        requestId: "file-upload",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function unauthenticated(): Response {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Not authenticated",
        retryable: false,
      },
      requestId: "file-content",
    },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
