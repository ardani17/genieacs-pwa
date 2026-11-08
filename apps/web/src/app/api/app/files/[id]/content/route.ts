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
import { FILE_UPLOAD_MAX_BYTES } from "@contracts/resources.ts";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

// Byte-counted passthrough: the 100MiB cap is enforced on the ACTUAL
// bytes streamed, not the (optional, spoofable) Content-Length. Past
// the limit the stream errors — the upstream fetch aborts mid-body
// and the engine keeps the previous firmware version intact.
function countBytes(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): ReadableStream<Uint8Array> | null {
  if (!body) return body;
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) {
          controller.error(new Error("upload exceeds size limit"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export const dynamic = "force-dynamic";

// File content: GET streams the native blob (status/type/disposition
// preserved, no envelope, no-store); PUT streams an octet-stream body up
// to 100MiB to the native upload endpoint with a metadata-header
// allowlist. The browser cancelling aborts the upstream request.
export async function GET(
  request: Request,
  paramsCtx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = requestContextFrom(request);
  const { id } = await paramsCtx.params;

  // GET is a safe read: plain browser download links carry no
  // X-App-Request/Origin. The session cookie and the engine's
  // files:2 filter still gate the download.
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return unauthenticated(ctx);

  try {
    // Single-range requests pass through with a VALIDATED shape only
    // (fixed header name; anything malformed is dropped and the engine
    // serves the full body).
    const clientRange = request.headers.get("range") ?? "";
    const forwardRange = /^bytes=(\d*)-(\d*)$/.test(clientRange.trim())
      ? { Range: clientRange.trim() }
      : {};
    const upstream = await engineFetch(
      `/api/blob/files/${encodeURIComponent(id)}`,
      {
        cookie,
        requestId: ctx.requestId,
        ...(Object.keys(forwardRange).length ? { headers: forwardRange } : {}),
        // The abort signal stays attached for the WHOLE streamed body,
        // so the budget must cover the transfer, not just the headers:
        // uploads up to 100MiB are allowed, and 100MiB over a 10 Mbps
        // link takes ~80s — a 30s cap truncated every large download.
        timeoutMs: 300_000,
      },
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
          requestId: ctx.requestId,
        },
        { status: upstream.status, headers: correlationHeaders(ctx) },
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
        // Range responses keep their partial-content markers.
        ...(upstream.headers.get("content-range")
          ? { "Content-Range": upstream.headers.get("content-range")! }
          : {}),
        ...(upstream.headers.get("accept-ranges")
          ? { "Accept-Ranges": upstream.headers.get("accept-ranges")! }
          : {}),
        ...correlationHeaders(ctx),
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
        requestId: ctx.requestId,
      },
      { status: 502, headers: correlationHeaders(ctx) },
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
  paramsCtx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = requestContextFrom(request);
  const { id } = await paramsCtx.params;
  // Contracts.md mutation rules on the upload itself.
  const sameOrigin = requireSameOrigin(request, PUBLIC_ORIGIN);
  if (!sameOrigin.ok)
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Permintaan ditolak (same-origin)",
          retryable: false,
        },
        requestId: ctx.requestId,
      },
      { status: 403, headers: correlationHeaders(ctx) },
    );
  const cookie = nativeCookieFrom(request.headers.get("cookie"));
  if (!cookie) return unauthenticated(ctx) as NextResponse;

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
        requestId: ctx.requestId,
      },
      { status: 413, headers: correlationHeaders(ctx) },
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
          // Correlation on the raw streaming fetch (engineFetch cannot
          // carry a duplex body): the id joins engine access logs.
          "X-Request-Id": ctx.requestId,
        },
        body: countBytes(request.body, FILE_UPLOAD_MAX_BYTES),
        // @ts-expect-error Node undici duplex streaming
        duplex: "half",
        // Client aborts propagate (request.signal); the 120s cap only
        // guards against abandoned streams.
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
      },
    );
    if (upstream.ok)
      return NextResponse.json(
        { ok: true, data: { uploaded: true }, requestId: ctx.requestId },
        { headers: correlationHeaders(ctx) },
      );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: upstream.status === 403 ? "FORBIDDEN" : "BACKEND_UNAVAILABLE",
          message: "Upload rejected",
          retryable: upstream.status >= 500,
        },
        requestId: ctx.requestId,
      },
      {
        status: upstream.status === 403 ? 403 : 502,
        headers: correlationHeaders(ctx),
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
        requestId: ctx.requestId,
      },
      { status: 502, headers: correlationHeaders(ctx) },
    );
  }
}

function unauthenticated(ctx: RequestContext): Response {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Not authenticated",
        retryable: false,
      },
      requestId: ctx.requestId,
    },
    { status: 401, headers: correlationHeaders(ctx) },
  );
}
