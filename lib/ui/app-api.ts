// App API sub-router (/api/...): session introspection and self password
// change used by the BFF. Safe DTOs only — no user snapshot export.

import Router from "@koa/router";
import { and } from "../common/expression/util.ts";
import { getUiConfig, getUsers } from "./local-cache.ts";
import { toSafeSession } from "./session.ts";
import { changeOwnPassword } from "./self-password.ts";
import { sendSafeLegacyError } from "./safe-error.ts";
import { authorizeAppResource } from "./app-permissions.ts";
import { runDeviceDiagnostics } from "./device-diagnostics.ts";
import { resolveProfile } from "../../packages/device-profiles/src/resolve.ts";
import {
  validOperationId,
  type DeviceCommandRequest,
} from "../../packages/app-contracts/src/commands.ts";
import {
  CommandExecutionError,
  authorizeOperationRead,
  executeAuthorizedTasks,
} from "./device-commands.ts";
import {
  getOperation,
  operationOutcome,
  requestFingerprint,
} from "./operation-store.ts";
import { executeWanOperation } from "./wan-operations.ts";
import { validateWanOperationRequest } from "../../packages/app-contracts/src/wan.ts";
import { emitPermissionDenied } from "../engine-app-logger.ts";
import * as db from "./db.ts";
import { buildLogQuery } from "./log-query.ts";

// Minimal structural type for the Koa context pieces appError touches.
interface ErrorCtx {
  status: number;
  type: string;
  set: (field: string, value: string) => void;
  body: unknown;
}

function appError(
  ctx: ErrorCtx,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): void {
  ctx.status = status;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "no-store");
  ctx.body = JSON.stringify({
    ok: false,
    error: { code, message, retryable },
  });
}

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
      // Expiry comes from the VALIDATED token claims (the middleware
      // rejects tokens without finite iat/exp), so polling never slides
      // the session forward.
      tokenExpiresAt:
        typeof ctx.state.user.exp === "number"
          ? new Date(ctx.state.user.exp * 1000).toISOString()
          : undefined,
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
  // device is 404 to this caller. Compose with and() — a bare
  // [filter, equality] array is a LIST literal, not an AND, which the
  // query synthesizer rejects ("Invalid query expression") and turned
  // every lookup, including missing devices, into a 500.
  const deviceQuery = and(filter, [
    "=",
    ["PARAM", "DeviceID.ID"],
    ctx.params.id,
  ]);
  const { value: device } = await db.query("devices", deviceQuery).next();
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

// GET /api/app/devices/:id/profile — resolver profile + capabilities.
// devices:2 + the caller's device filter decide access; the response is
// derived server-side from the authorized flat device and carries no
// parameter values (therefore no secrets).
router.get("/app/devices/:id/profile", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);

  const authorizer = ctx.state.authorizer;
  const filter = authorizer.getFilter("devices", 2);
  if (!authorizer.hasAccess("devices", 2)) return void (ctx.status = 403);

  const deviceQuery = and(filter, [
    "=",
    ["PARAM", "DeviceID.ID"],
    ctx.params.id,
  ]);
  const { value: device } = await db.query("devices", deviceQuery).next();
  if (!device) return void (ctx.status = 404);

  const profile = resolveProfile(
    device as Record<string, { value?: [unknown, string] }>,
  );

  ctx.status = 200;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "no-store");
  ctx.body = JSON.stringify({ profile });
});

// POST /api/app/devices/:id/commands — guarded executor with operation
// idempotency. The device id comes from the URL only; client-supplied
// task _id fields are dropped inside the executor, validation and the
// management-WAN guard run before any task is inserted.
router.post("/app/devices/:id/commands", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);

  const body = ctx.request.body as Partial<DeviceCommandRequest> | null;
  if (!validOperationId(body?.operationId) || !Array.isArray(body?.tasks)) {
    appError(
      ctx,
      400,
      "VALIDATION",
      "operationId (UUID) dan tasks wajib diisi",
      false,
    );
    return;
  }
  if (body.deviceId != null && body.deviceId !== ctx.params.id) {
    appError(
      ctx,
      400,
      "VALIDATION",
      "deviceId body tidak cocok dengan target URL",
      false,
    );
    return;
  }

  const fingerprint = requestFingerprint({
    deviceId: ctx.params.id,
    tasks: body.tasks,
  });

  try {
    const result = await executeAuthorizedTasks(
      {
        authorizer: ctx.state.authorizer,
        configSnapshot: ctx.state.configSnapshot,
        username: ctx.state.user.username,
      },
      ctx.params.id,
      body.tasks,
      {
        operation: {
          operationId: body.operationId,
          kind: "commands",
          fingerprint,
        },
      },
    );
    ctx.status = 200;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "no-store");
    ctx.body = JSON.stringify({
      ok: true,
      data: result.outcome ?? {
        operationId: body.operationId,
        deviceId: ctx.params.id,
        state: result.state,
        phases: result.phases,
      },
    });
  } catch (err) {
    if (err instanceof CommandExecutionError) {
      if (err.status === 403) emitPermissionDenied(ctx, "Commit tasks (app)");
      appError(
        ctx,
        err.status,
        err.code,
        err.message,
        err.status === 503 || err.status === 504,
      );
      return;
    }
    appError(ctx, 500, "INTERNAL", "Perintah perangkat gagal dijalankan", true);
  }
});

// GET /api/app/operations/:operationId — stored outcome for the owner
// (or an authorized admin). Never re-submits anything.
router.get("/app/operations/:operationId", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);

  const operation = await getOperation(ctx.params.operationId);
  if (!operation) {
    appError(ctx, 404, "NOT_FOUND", "Operasi tidak ditemukan", false);
    return;
  }

  const allowed = await authorizeOperationRead(
    ctx.state.authorizer,
    operation,
    ctx.state.user.username,
  );
  if (!allowed) {
    emitPermissionDenied(ctx, "Read operation");
    appError(ctx, 403, "FORBIDDEN", "Tidak ada izin membaca operasi", false);
    return;
  }

  ctx.status = 200;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "no-store");
  ctx.body = JSON.stringify({ ok: true, data: operationOutcome(operation) });
});

// POST /api/app/devices/:id/wan — phased WAN orchestration (write →
// refresh → binding reapply → verify) through the guarded executor and
// the shared operation store. The browser sends form settings only.
router.post("/app/devices/:id/wan", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);

  const parsed = validateWanOperationRequest(ctx.request.body, ctx.params.id);
  if (!parsed.ok) {
    appError(
      ctx,
      400,
      "VALIDATION",
      (parsed as { error: string }).error,
      false,
    );
    return;
  }

  try {
    const outcome = await executeWanOperation(
      {
        authorizer: ctx.state.authorizer,
        configSnapshot: ctx.state.configSnapshot,
        username: ctx.state.user.username,
      },
      parsed.value,
    );
    ctx.status = 200;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "no-store");
    ctx.body = JSON.stringify({ ok: true, data: outcome });
  } catch (err) {
    if (err instanceof CommandExecutionError) {
      if (err.status === 403) emitPermissionDenied(ctx, "WAN operation");
      appError(ctx, err.status, err.code, err.message, err.status === 503);
      return;
    }
    appError(ctx, 500, "INTERNAL", "Operasi WAN gagal dijalankan", true);
  }
});

// Health for internal callers reuses /status from the root router.

export default router;
