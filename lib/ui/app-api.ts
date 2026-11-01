// App API sub-router (/api/...): session introspection and self password
// change used by the BFF. Safe DTOs only — no user snapshot export.

import Router from "@koa/router";
import { getUiConfig, getUsers } from "./local-cache.ts";
import { toSafeSession } from "./session.ts";
import { changeOwnPassword } from "./self-password.ts";
import { sendSafeLegacyError } from "./safe-error.ts";
import { authorizeAppResource } from "./app-permissions.ts";
import { runDeviceDiagnostics } from "./device-diagnostics.ts";
import * as db from "./db.ts";
import { buildLogQuery } from "./log-query.ts";

const router = new Router();

// GET /api/session — the authenticated user's safe session DTO.
router.get("/session", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);

  const user = getUsers(ctx.state.configSnapshot)[ctx.state.user.username];
  if (!user) return void (ctx.status = 401);

  const ui = getUiConfig(ctx.state.configSnapshot);
  const revision = ctx.state.configSnapshot as string;

  ctx.type = "application/json";
  ctx.set("Cache-Control", "no-store");
  ctx.body = JSON.stringify(
    toSafeSession({
      username: ctx.state.user.username,
      roles: user.roles,
      permissionSets: ctx.state.authorizer.getPermissionSets(),
      uiConfig: ui as unknown as Record<string, unknown>,
      configRevision: revision,
    }),
  );
});

// POST /api/password — self-service change; requires being logged in.
router.post("/password", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);

  const body = ctx.request.body as {
    oldPassword?: string;
    newPassword?: string;
  };
  const result = await changeOwnPassword(
    ctx.state.configSnapshot,
    ctx.state.user.username,
    body?.oldPassword ?? "",
    body?.newPassword ?? "",
  );

  if (!result.ok) {
    // Same safe error for wrong old password and unknown user.
    sendSafeLegacyError(
      ctx,
      result.reason === "weak_password" ? 400 : 401,
      "password_change_failed",
      result.reason === "weak_password"
        ? "The new password does not meet the policy."
        : "Authentication failed, check your current password.",
    );
    return;
  }

  ctx.status = 204;
  ctx.set("Cache-Control", "no-store");
});

// POST /api/app/logs — permission logs:3 + bounded query executed
// against the internal log store (fixed origin), 5s budget, NDJSON
// passthrough of checked fields only.
router.post("/app/logs", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);
  try {
    authorizeAppResource(ctx.state.authorizer, "logs", 3);
  } catch {
    return void (ctx.status = 403);
  }

  const filters = ctx.request.body as Record<string, unknown>;
  let q;
  try {
    q = buildLogQuery(filters as never);
  } catch (err) {
    ctx.status = 400;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "VALIDATION",
        message: (err as Error).message,
        retryable: false,
      },
      requestId: "app-logs",
    });
    return;
  }

  const logUrl = process.env["LOG_URL"];
  if (!logUrl) {
    ctx.status = 503;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Log store unavailable",
        retryable: true,
      },
      requestId: "app-logs",
    });
    return;
  }

  let response: Response;
  try {
    const params = new URLSearchParams({
      query: q.query,
      limit: String(q.limit),
      offset: String(q.offset),
      start: Math.floor(Date.parse(q.start) / 1000) + "s",
      end: Math.floor(Date.parse(q.end) / 1000) + "s",
    });
    response = await fetch(logUrl + "/select/logsql/query", {
      method: "POST",
      body: params,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    ctx.status = 503;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Log store unavailable",
        retryable: true,
      },
      requestId: "app-logs",
    });
    return;
  }

  if (!response.ok) {
    ctx.status = 503;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Log store unavailable",
        retryable: true,
      },
      requestId: "app-logs",
    });
    return;
  }

  ctx.status = 200;
  ctx.type = "application/x-ndjson";
  ctx.set("Cache-Control", "no-store");
  ctx.body = await response.text();
});

// GET /api/app/vpn/status — vpn:1 to read, honest unconfigured/unavailable
// until the controller management arrives (M07).
router.get("/app/vpn/status", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);
  try {
    authorizeAppResource(ctx.state.authorizer, "vpn", 1);
  } catch {
    return void (ctx.status = 403);
  }

  ctx.status = 200;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "no-store");
  ctx.body = JSON.stringify({
    state: "unconfigured",
    reason: "vpn controller management not deployed yet",
    observedAt: new Date().toISOString(),
    controllerReachable: false,
    lastSuccessAt: null,
  });
});

// POST /app/devices/:id/diagnostics — devices:2 + the caller's device
// filter decide access FIRST; the target is then derived server-side from
// the authorized device. Only the device id comes from the browser.
router.post("/app/devices/:id/diagnostics", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);

  const authorizer = ctx.state.authorizer;
  const filter = authorizer.getFilter("devices", 2);
  if (!authorizer.hasAccess("devices", 2)) return void (ctx.status = 403);

  // Fetch the device THROUGH the permission filter: a filtered-out
  // device is 404 to this caller.
  const { value: device } = await db
    .query("devices", [filter, ["=", ["PARAM", "DeviceID.ID"], ctx.params.id]])
    .next();
  if (!device) return void (ctx.status = 404);

  const controllerAvailable = process.env["DIAGNOSTICS_CONTROLLER"] === "1";
  const result = await runDeviceDiagnostics(
    device as Record<string, unknown>,
    controllerAvailable,
  );

  ctx.status = 200;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "no-store");
  ctx.body = JSON.stringify(result);
});

// Health for internal callers reuses /status from the root router.

export default router;
