import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { VpnController } from "./controller.ts";

export function tokenFromFile(path: string | undefined): Buffer | null {
  try {
    const token = readFileSync(path!, "utf8").trim();
    return token ? Buffer.from(token) : null;
  } catch {
    return null;
  }
}
export function createVpnServer(
  controller: VpnController,
  token: () => Buffer | null,
  logging?: () => object,
): http.Server {
  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "application/json");
    const requestId = req.headers["x-request-id"];
    const reply = (status: number, data: unknown): void => {
      res.writeHead(status);
      res.end(
        JSON.stringify({
          ok: status < 400,
          ...(status < 400
            ? { data }
            : { error: { code: data, retryable: status >= 500 } }),
          requestId,
        }),
      );
    };
    const expected = token();
    const auth = req.headers.authorization;
    const candidate = auth?.startsWith("Bearer ")
      ? Buffer.from(auth.slice(7))
      : null;
    if (
      !expected ||
      !candidate ||
      expected.length !== candidate.length ||
      !timingSafeEqual(expected, candidate)
    ) {
      reply(401, "UNAUTHENTICATED");
      return;
    }
    if (
      typeof requestId !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)
    ) {
      reply(400, "INVALID_REQUEST_ID");
      return;
    }
    const path = req.url;
    try {
      if (req.method === "GET" && (path === "/status" || path === "/health")) {
        reply(
          200,
          path === "/health"
            ? { status: controller.status(), logging: logging?.() }
            : controller.status(),
        );
        return;
      }
      if (
        !["/profile", "/reconnect", "/diagnose", "/probe"].includes(
          path ?? "",
        ) ||
        (path === "/profile" ? req.method !== "PUT" : req.method !== "POST")
      ) {
        reply(404, "NOT_FOUND");
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += String(chunk);
        if (Buffer.byteLength(raw) > 16384) {
          reply(413, "BODY_TOO_LARGE");
          return;
        }
      }
      let body: unknown;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        reply(400, "VALIDATION");
        return;
      }
      if (
        path !== "/profile" &&
        path !== "/probe" &&
        (!body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length)
      ) {
        reply(400, "VALIDATION");
        return;
      }
      if (path === "/profile") reply(200, await controller.profile(body));
      else if (path === "/reconnect") reply(200, await controller.reconnect());
      else if (path === "/probe") reply(200, await controller.probe(body));
      else reply(200, await controller.diagnose());
    } catch (err) {
      const code = (err as Error).message;
      reply(
        code === "CONFLICT"
          ? 409
          : code === "UNCONFIGURED"
            ? 404
            : code === "INVALID_PROFILE"
              ? 400
              : 503,
        ["CONFLICT", "UNCONFIGURED", "INVALID_PROFILE"].includes(code)
          ? code
          : "VPN_UNAVAILABLE",
      );
    }
  };
  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(503);
      res.end();
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  return server;
}
