// Engine-side application logger (RE-STD-09B): the SAME bounded/redacting
// logger the web process uses, with the engine "ui" service identity,
// emitting IN PARALLEL to the legacy logger — stdout/CLI behavior is
// untouched. Disabled unless UI_APP_LOG_FILE is set: with the default ""
// every call is a no-op and nothing is written, so bare-CLI and upstream
// behavior stays byte-identical. Compose opts the ui service in via
// GENIEACS_UI_APP_LOG_FILE=/logs/ui/app.ndjson on the shared volume
// Vector reads.
import { version as VERSION } from "../package.json";
import * as config from "./config.ts";
import { createAppLogger, type AppLogger } from "./app-logger.ts";

const NOOP_LOGGER: AppLogger = {
  emit() {
    // disabled — no file, no queue, no I/O
  },
  status() {
    return { state: "healthy", droppedEvents: 0, lastSuccessAt: null };
  },
  flush() {
    return Promise.resolve();
  },
};

let engineLogger: AppLogger | null = null;

export function getEngineAppLogger(): AppLogger {
  if (engineLogger) return engineLogger;
  const filePath = config.get("UI_APP_LOG_FILE") as string;
  if (!filePath) {
    engineLogger = NOOP_LOGGER;
    return engineLogger;
  }

  // The mount race on a FRESH shared volume (web and ui each initialize
  // their own subdirectory; the first mounter copies only its image's
  // content) is handled inside the shared core: createAppLogger creates
  // the directory eagerly and its sink recreates it on ENOENT. An
  // initially-unusable directory (a blocker on the path, a volume that
  // appears later) therefore degrades VISIBLY — state "degraded" with
  // lost events counted — and heals by itself once storage is repaired.
  // Never a crash, and never a silent "healthy" while events drop.

  engineLogger = createAppLogger({
    service: "ui",
    appVersion: VERSION ?? "dev",
    installationId:
      process.env.INSTALLATION_ID ?? "00000000-0000-0000-0000-000000000000",
    environment: process.env.NODE_ENV === "production" ? "production" : "test",
    filePath,
  });
  return engineLogger;
}

// ---------------------------------------------------------------------------
// Emission helpers: PARALLEL to the legacy logger calls at the same choke
// points — never replacing them. Correlation mirrors lib/logger.ts: only a
// valid-UUID x-request-id (forwarded by the BFF's engineFetch) is recorded,
// so ids cannot smuggle arbitrary text into logs.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface KoaLikeContext {
  get?: (name: string) => string | undefined;
  state?: { user?: { username?: string } | null } | null;
}

function correlation(ctx: KoaLikeContext | undefined): {
  requestId?: string;
  actorId?: string;
} {
  const out: { requestId?: string; actorId?: string } = {};
  const requestId = ctx?.get?.("x-request-id");
  if (typeof requestId === "string" && UUID_RE.test(requestId))
    out.requestId = requestId;
  const username = ctx?.state?.user?.username;
  if (typeof username === "string" && username) out.actorId = username;
  return out;
}

export function emitLoginOutcome(
  ctx: KoaLikeContext | undefined,
  ok: boolean,
  username?: string,
): void {
  const corr = correlation(ctx);
  getEngineAppLogger().emit({
    event: ok ? "auth.login_succeeded" : "auth.login_failed",
    level: ok ? "info" : "warn",
    ...corr,
    ...(username ? { actorId: username } : {}),
    outcome: ok ? "success" : "failure",
    message: ok ? "login succeeded" : "login failed",
  });
}

export function emitPermissionDenied(
  ctx: KoaLikeContext | undefined,
  action: string,
): void {
  getEngineAppLogger().emit({
    event: "auth.permission_denied",
    level: "warn",
    ...correlation(ctx),
    outcome: "failure",
    message: `not authorized: ${action}`,
  });
}
