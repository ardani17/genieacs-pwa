// App API sub-router (/api/...): session introspection and self password
// change used by the BFF. Safe DTOs only — no user snapshot export.

import Router from "@koa/router";
import { getUiConfig, getUsers } from "./local-cache.ts";
import { toSafeSession } from "./session.ts";
import { changeOwnPassword } from "./self-password.ts";
import { sendSafeLegacyError } from "./safe-error.ts";

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

// Health for internal callers reuses /status from the root router.

export default router;
