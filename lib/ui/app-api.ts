// App API sub-router (/api/...): session introspection and self password
// change used by the BFF. Safe DTOs only — no user snapshot export.

import { randomUUID as cryptoRandomUUID } from "node:crypto";
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
import {
  emitPermissionDenied,
  getEngineAppLogger,
} from "../engine-app-logger.ts";
import { generateSalt, hashPassword } from "../auth.ts";
import { collections } from "../db/db.ts";
import {
  countAdminsAfter,
  fetchScopedUser,
  userPassesFilter,
  withLastAdminGuard,
  LastAdminError,
} from "./users-guard.ts";
import { del as cacheDel } from "../cache.ts";
import * as db from "./db.ts";
import { buildLogQuery } from "./log-query.ts";

interface ErrorCtx {
  status: number;
  type: string;
  set: (field: string, value: string) => void;
  body: unknown;
  get?: (field: string) => string | undefined;
  state?: { requestId?: string };
}

function errorRequestId(ctx: ErrorCtx): string {
  // The BFF proxy mints a UUID per request; accept it when valid,
  // otherwise mint one (contracts.md ApiResult requestId).
  const inbound = ctx.get?.("x-request-id");
  if (inbound && /^[0-9a-f-]{36}$/i.test(inbound)) return inbound;
  return cryptoRandomUUID();
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
  ctx.set("Cache-Control", "private, no-store");
  ctx.body = JSON.stringify({
    ok: false,
    error: { code, message, retryable },
    requestId: errorRequestId(ctx),
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
  ctx.set("Cache-Control", "private, no-store");
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
  ctx.set("Cache-Control", "private, no-store");
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
    if (typeof filters["query"] === "string" && filters["query"]) {
      // The BFF pre-built this query with the same closed builder;
      // accept it with engine-side bounds — never a raw client query
      // (the BFF only forwards what its own builder produced).
      const limit = Math.min(
        500,
        Math.max(1, Number(filters["limit"] ?? 100) || 100),
      );
      const offset = Math.min(
        5000,
        Math.max(0, Number(filters["offset"] ?? 0) || 0),
      );
      if (
        typeof filters["start"] !== "string" ||
        typeof filters["end"] !== "string"
      )
        throw new Error("invalid window");
      q = {
        query: filters["query"],
        start: filters["start"],
        end: filters["end"],
        limit,
        offset,
      };
    } else {
      q = buildLogQuery(
        filters as import("../../packages/app-contracts/src/log-query.ts").LogFilters,
      );
    }
  } catch (err) {
    ctx.status = 400;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "private, no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "VALIDATION",
        message: (err as Error).message,
        retryable: false,
      },
      requestId: errorRequestId(ctx),
    });
    return;
  }

  const logUrl = process.env["LOG_URL"];
  if (!logUrl) {
    ctx.status = 503;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "private, no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Log store unavailable",
        retryable: true,
      },
      requestId: errorRequestId(ctx),
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
    ctx.set("Cache-Control", "private, no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Log store unavailable",
        retryable: true,
      },
      requestId: errorRequestId(ctx),
    });
    return;
  }

  if (!response.ok) {
    ctx.status = 503;
    ctx.type = "application/json";
    ctx.set("Cache-Control", "private, no-store");
    ctx.body = JSON.stringify({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Log store unavailable",
        retryable: true,
      },
      requestId: errorRequestId(ctx),
    });
    return;
  }

  ctx.status = 200;
  ctx.type = "application/x-ndjson";
  ctx.set("Cache-Control", "private, no-store");
  ctx.body = await response.text();
  // Audit: filter FIELD NAMES only (never values/results) per contract.
  getEngineAppLogger().emit({
    event: "logs.query",
    level: "info",
    message: "log search executed",
    ...(ctx.get?.("x-request-id") ? { requestId: errorRequestId(ctx) } : {}),
    actorId: ctx.state.user.username,
    details: { fields: Object.keys(filters).sort() },
  });
});

// POST /api/app/logs/export — bounded export (≤10.000 rows, 30s
// budget) through the same checked-field query the search uses. The
// BFF pre-builds the query; this side only validates bounds and
// executes. Emits the contract audit event logs.export (filter field
// names + row count, never contents).
router.post("/app/logs/export", async (ctx) => {
  if (!ctx.state.user?.username) return void (ctx.status = 401);
  try {
    authorizeAppResource(ctx.state.authorizer, "logs", 3);
  } catch {
    return void (ctx.status = 403);
  }

  const q = ctx.request.body as {
    query?: unknown;
    start?: unknown;
    end?: unknown;
    limit?: unknown;
    offset?: unknown;
  };
  const LIMIT_MAX = 10_000;
  const OFFSET_MAX = 5_000;
  if (typeof q.query !== "string" || !q.query) {
    appError(ctx, 400, "VALIDATION", "Query export tidak valid", false);
    return;
  }
  const limit = Math.min(
    LIMIT_MAX,
    Math.max(1, Number(q.limit ?? LIMIT_MAX) || LIMIT_MAX),
  );
  const offset = Math.min(OFFSET_MAX, Math.max(0, Number(q.offset ?? 0) || 0));
  if (typeof q.start !== "string" || typeof q.end !== "string") {
    appError(ctx, 400, "VALIDATION", "Rentang waktu export wajib", false);
    return;
  }

  const logUrl = process.env["LOG_URL"];
  if (!logUrl) {
    appError(ctx, 503, "BACKEND_UNAVAILABLE", "Log store unavailable", true);
    return;
  }

  let response: Response;
  try {
    const params = new URLSearchParams({
      query: q.query,
      limit: String(limit),
      offset: String(offset),
      start: String(Math.floor(Date.parse(q.start) / 1000)) + "s",
      end: String(Math.floor(Date.parse(q.end) / 1000)) + "s",
    });
    response = await fetch(logUrl + "/select/logsql/query", {
      method: "POST",
      body: params,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    appError(ctx, 503, "BACKEND_UNAVAILABLE", "Log store unavailable", true);
    return;
  }
  if (!response.ok) {
    appError(ctx, 503, "BACKEND_UNAVAILABLE", "Log store unavailable", true);
    return;
  }

  const body = await response.text();
  const rows = body ? body.split("\n").filter(Boolean).length : 0;
  getEngineAppLogger().emit({
    event: "logs.export",
    level: "info",
    message: "log export executed",
    requestId: errorRequestId(ctx),
    actorId: ctx.state.user.username,
    details: { rows, limit, offset },
  });

  ctx.status = 200;
  ctx.type = "application/x-ndjson";
  ctx.set("Cache-Control", "private, no-store");
  ctx.body = body;
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
  ctx.set("Cache-Control", "private, no-store");
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
  ctx.set("Cache-Control", "private, no-store");
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
  ctx.set("Cache-Control", "private, no-store");
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
    ctx.set("Cache-Control", "private, no-store");
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
  ctx.set("Cache-Control", "private, no-store");
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
    ctx.set("Cache-Control", "private, no-store");
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

// --- Admin user management (M06-C): users:3 + native validator.
// Passwords are hashed SERVER-side with the native salt/hash; hashes
// and salts are never returned or exported. The last admin role
// deletion is refused with a recovery hint instead of locking
// everybody out.
function parseRoles(input: unknown): string[] | null {
  if (typeof input === "string")
    return input
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
  if (Array.isArray(input) && input.every((r) => typeof r === "string"))
    return input as string[];
  return null;
}

async function adminUsersGuard(ctx: {
  state: {
    authorizer: import("../common/authorizer.ts").default;
    user?: { username?: string };
  };
}): Promise<boolean> {
  if (!ctx.state.user?.username) return false;
  const authorizer = ctx.state.authorizer;
  if (!authorizer.hasAccess("users", 3)) return false;
  return true;
}

router.post("/app/admin/users", async (ctx) => {
  if (!(await adminUsersGuard(ctx))) {
    emitPermissionDenied(ctx, "Create user");
    appError(ctx, 403, "FORBIDDEN", "Tidak ada izin mengelola pengguna", false);
    return;
  }
  const body = ctx.request.body as {
    username?: string;
    password?: string;
    roles?: unknown;
  } | null;
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const roles = parseRoles(body?.roles);
  if (!/^[^:/]+$/.test(username) || !username) {
    appError(ctx, 400, "VALIDATION", "Nama pengguna tidak valid", false);
    return;
  }
  if (password.length < 8) {
    appError(ctx, 400, "VALIDATION", "Password minimal 8 karakter", false);
    return;
  }
  if (!roles?.length) {
    appError(ctx, 400, "VALIDATION", "Minimal satu role", false);
    return;
  }
  if (!userPassesFilter(ctx.state.authorizer, username)) {
    // Out-of-scope identities are indistinguishable from missing ones.
    appError(ctx, 404, "NOT_FOUND", "Pengguna tidak ditemukan", false);
    return;
  }
  const existing = await collections.users.findOne({ _id: username });
  if (existing) {
    appError(ctx, 409, "CONFLICT", "Pengguna sudah ada", false);
    return;
  }
  const validate = ctx.state.authorizer.getValidator("users", {
    _id: username,
    roles,
  });
  if (!validate("put")) {
    emitPermissionDenied(ctx, "Create user");
    appError(ctx, 403, "FORBIDDEN", "Validator menolak pengguna ini", false);
    return;
  }
  const salt = await generateSalt(64);
  const hash = await hashPassword(password, salt);
  try {
    await withLastAdminGuard(async () => {
      const remaining = await countAdminsAfter(
        [],
        new Map([[username, roles.join(",")]]),
      );
      await collections.users.insertOne({
        _id: username,
        password: hash,
        salt,
        roles: roles.join(","),
      });
      return { remainingAdmins: remaining };
    });
  } catch (err) {
    if (err instanceof LastAdminError) {
      appError(ctx, 409, "CONFLICT", err.message, false);
      return;
    }
    if ((err as { status?: number }).status === 503) {
      appError(ctx, 503, "CONFLICT", (err as Error).message, true);
      return;
    }
    throw err;
  }
  await cacheDel("ui-local-cache-hash");
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "private, no-store");
  ctx.body = JSON.stringify({
    ok: true,
    data: { username, roles },
  });
});

router.put("/app/admin/users/:id/roles", async (ctx) => {
  if (!(await adminUsersGuard(ctx))) {
    emitPermissionDenied(ctx, "Update user roles");
    appError(ctx, 403, "FORBIDDEN", "Tidak ada izin mengelola pengguna", false);
    return;
  }
  const roles = parseRoles((ctx.request.body as { roles?: unknown })?.roles);
  if (!roles?.length) {
    appError(ctx, 400, "VALIDATION", "Minimal satu role", false);
    return;
  }
  // Scoped fetch: an out-of-scope target is a 404, not a 403 leak.
  const user = await fetchScopedUser(ctx.state.authorizer, ctx.params.id);
  if (!user) {
    appError(ctx, 404, "NOT_FOUND", "Pengguna tidak ditemukan", false);
    return;
  }
  const validate = ctx.state.authorizer.getValidator("users", {
    _id: ctx.params.id,
    roles,
  });
  if (!validate("put")) {
    emitPermissionDenied(ctx, "Update user roles");
    appError(ctx, 403, "FORBIDDEN", "Validator menolak perubahan ini", false);
    return;
  }
  try {
    await withLastAdminGuard(async () => {
      const remaining = await countAdminsAfter(
        [],
        new Map([[ctx.params.id, roles.join(",")]]),
      );
      if (remaining < 1) throw new LastAdminError();
      await collections.users.updateOne(
        { _id: ctx.params.id },
        { $set: { roles: roles.join(",") } },
      );
      return { remainingAdmins: remaining };
    });
  } catch (err) {
    if (err instanceof LastAdminError) {
      appError(ctx, 409, "CONFLICT", err.message, false);
      return;
    }
    if ((err as { status?: number }).status === 503) {
      appError(ctx, 503, "CONFLICT", (err as Error).message, true);
      return;
    }
    throw err;
  }
  await cacheDel("ui-local-cache-hash");
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "private, no-store");
  ctx.body = JSON.stringify({ ok: true, data: { username: ctx.params.id } });
});

router.put("/app/admin/users/:id/password", async (ctx) => {
  if (!(await adminUsersGuard(ctx))) {
    emitPermissionDenied(ctx, "Reset user password");
    appError(ctx, 403, "FORBIDDEN", "Tidak ada izin mengelola pengguna", false);
    return;
  }
  const newPassword = String(
    (ctx.request.body as { newPassword?: string })?.newPassword ?? "",
  );
  if (newPassword.length < 8) {
    appError(ctx, 400, "VALIDATION", "Password minimal 8 karakter", false);
    return;
  }
  // Scoped fetch: out-of-scope targets 404 (a password reset outside
  // the caller's user filter must not exist to them).
  const user = await fetchScopedUser(ctx.state.authorizer, ctx.params.id);
  if (!user) {
    appError(ctx, 404, "NOT_FOUND", "Pengguna tidak ditemukan", false);
    return;
  }
  const validate = ctx.state.authorizer.getValidator("users", user);
  if (!validate("password", { password: newPassword })) {
    emitPermissionDenied(ctx, "Reset user password");
    appError(ctx, 403, "FORBIDDEN", "Validator menolak password ini", false);
    return;
  }
  const salt = await generateSalt(64);
  const password = await hashPassword(newPassword, salt);
  await collections.users.updateOne(
    { _id: ctx.params.id },
    { $set: { password, salt } },
  );
  await cacheDel("ui-local-cache-hash");
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.set("Cache-Control", "private, no-store");
  ctx.body = JSON.stringify({ ok: true, data: { username: ctx.params.id } });
});

// Health for internal callers reuses /status from the root router.

export default router;
