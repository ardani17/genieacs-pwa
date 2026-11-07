import { Readable } from "node:stream";
import Router from "@koa/router";
import * as db from "./db.ts";
import * as apiFunctions from "../api-functions.ts";
import { evaluate, and, extractParams } from "../common/expression/util.ts";
import { parse } from "../common/expression/parser.ts";
import * as logger from "../logger.ts";
import {
  emitPermissionDenied,
  getEngineAppLogger,
} from "../engine-app-logger.ts";
import { Expression } from "../types.ts";
import { generateSalt, hashPassword } from "../auth.ts";
import { del } from "../cache.ts";
import Authorizer from "../common/authorizer.ts";
import { ping } from "../ping.ts";
import { decodeTag } from "../util.ts";
import { stringify as yamlStringify } from "../common/yaml.ts";
import { ResourceLockedError } from "../common/errors.ts";
import { quoteCsvCell, sendSafeLegacyError } from "./safe-error.ts";
import {
  LastAdminError,
  countAdminsAfter,
  fetchScopedUser,
  userPassesFilter,
  withLastAdminGuard,
} from "./users-guard.ts";
import {
  CommandExecutionError,
  executeAuthorizedTasks,
} from "./device-commands.ts";
import {
  SECRET_MASK,
  maskConfigRow,
  revealRequested,
} from "./config-masking.ts";
import { FileTooLargeError } from "./db.ts";
import { collections } from "../db/db.ts";

const router = new Router();
export default router;

function logUnauthorizedWarning(log): void {
  const action = log.message;
  // Captured BEFORE the legacy call: lib/logger.ts's flatten MUTATES
  // the log object (and deletes .context) while building its record.
  const ctx = log.context;
  log.message += " not authorized";
  logger.accessWarn(log);
  // Structured pipeline event IN PARALLEL (no-op unless
  // UI_APP_LOG_FILE is configured); the legacy warn above is untouched.
  emitPermissionDenied(ctx, action);
}

const RESOURCE_DELETE = 1 << 0;
const RESOURCE_PUT = 1 << 1;

const RESOURCE_IDS = {
  devices: "DeviceID.ID",
  presets: "_id",
  provisions: "_id",
  files: "_id",
  virtualParameters: "_id",
  config: "_id",
  permissions: "_id",
  users: "_id",
  faults: "_id",
  tasks: "_id",
};

const resources = {
  devices: 0 | RESOURCE_DELETE,
  presets: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  provisions: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  files: 0 | RESOURCE_DELETE,
  virtualParameters: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  config: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  permissions: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  users: 0 | RESOURCE_DELETE | RESOURCE_PUT,
  faults: 0 | RESOURCE_DELETE,
  tasks: 0,
};

function singleParam(p: string | string[]): string {
  return Array.isArray(p) ? p[p.length - 1] : p;
}

router.get(`/devices/:id.csv`, async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Query device (CSV)",
    context: ctx,
    id: ctx.params.id,
  };

  const filter = and(authorizer.getFilter("devices", 2), [
    "=",
    ["PARAM", RESOURCE_IDS.devices],
    ctx.params.id,
  ]);

  if (!authorizer.hasAccess("devices", 2)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const { value: device } = await db.query("devices", filter).next();
  if (!device) return void (ctx.status = 404);

  ctx.type = "text/csv";
  ctx.attachment(
    `device-${ctx.params.id}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "")}.csv`,
  );

  const lines: string[] = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp",
  ];

  for (const k of Object.keys(device).sort()) {
    const p = device[k];
    let value = "";
    let type = "";
    if (p.value) {
      value = p.value[0];
      type = p.value[1];
      if (type === "xsd:dateTime" && typeof value === "number")
        value = new Date(value).toJSON();
    }

    const row = [
      k,
      p.object,
      new Date(p.objectTimestamp).toJSON(),
      p.writable,
      new Date(p.writableTimestamp).toJSON(),
      quoteCsvCell(value),
      type,
      new Date(p.valueTimestamp).toJSON(),
      p.notification,
      new Date(p.notificationTimestamp).toJSON(),
      p.accessList ? p.accessList.join(", ") : "",
      new Date(p.accessListTimestamp).toJSON(),
    ];
    lines.push(row.map((r) => (r != null ? r : "")).join(","));
  }
  ctx.body = lines.join("\n");
  logger.accessInfo(log);
});

for (const [resource, flags] of Object.entries(resources)) {
  router.head(`/${resource}`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    let filter: Expression = authorizer.getFilter(resource, 1);
    if (ctx.request.query.filter)
      filter = and(filter, parse(singleParam(ctx.request.query.filter)));

    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: ctx.request.query.filter,
      count: null,
    };

    if (!authorizer.hasAccess(resource, 1)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "OR",
        [">=", ["PARAM", "expiry"], Date.now() + 60000],
        ["IS NULL", ["PARAM", "expiry"]],
      ]);
    }

    const count = await db.count(resource, filter);

    ctx.set("X-Total-Count", `${count}`);
    ctx.body = "";

    log.count = count;
    logger.accessInfo(log);
  });

  router.get(`/${resource}`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const options: Parameters<typeof db.query>[2] = {};
    let filter: Expression = authorizer.getFilter(resource, 2);
    if (ctx.request.query.filter)
      filter = and(filter, parse(singleParam(ctx.request.query.filter)));
    if (ctx.request.query.limit) options.limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) options.skip = +ctx.request.query.skip;
    if (ctx.request.query.sort)
      options.sort = JSON.parse(singleParam(ctx.request.query.sort));
    if (ctx.request.query.projection) {
      options.projection = singleParam(ctx.request.query.projection)
        .split(",")
        .reduce((obj, k) => Object.assign(obj, { [k]: 1 }), {});
    }

    const log = {
      message: `Query ${resource}`,
      context: ctx,
      filter: ctx.request.query.filter,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort,
      projection: options.projection,
    };

    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "OR",
        [">=", ["PARAM", "expiry"], Date.now() + 60000],
        ["IS NULL", ["PARAM", "expiry"]],
      ]);
    }

    logger.accessInfo(log);
    ctx.type = "application/json";
    // Config list rows keep the SAME secret policy as the detail route
    // (M06-B): credential-looking values leave masked unless the caller
    // holds config:3 AND explicitly asked to reveal.
    const configReveal =
      resource === "config" &&
      authorizer.hasAccess("config", 3) &&
      revealRequested(ctx.request.headers["x-reveal-secrets"]);
    ctx.body = Readable.from(
      (async function* () {
        let c = 0;
        yield "[\n";
        for await (const obj of db.query(resource, filter, options))
          yield (c++ ? "," : "") +
            JSON.stringify(
              resource === "config"
                ? maskConfigRow(obj as Record<string, unknown>, configReveal)
                : obj,
            ) +
            "\n";
        yield "]";
      })(),
    );
  });

  // CSV download
  router.get(`/${resource}.csv`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const options: Parameters<typeof db.query>[2] = { projection: {} };
    let filter: Expression = authorizer.getFilter(resource, 2);
    if (ctx.request.query.filter)
      filter = and(filter, parse(singleParam(ctx.request.query.filter)));
    if (ctx.request.query.limit) options.limit = +ctx.request.query.limit;
    if (ctx.request.query.skip) options.skip = +ctx.request.query.skip;
    if (ctx.request.query.sort)
      options.sort = JSON.parse(singleParam(ctx.request.query.sort));

    const log = {
      message: `Query ${resource} (CSV)`,
      context: ctx,
      filter: ctx.request.query.filter,
      limit: options.limit,
      skip: options.skip,
      sort: options.sort,
    };

    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    const columns: Record<string, Expression> = JSON.parse(
      singleParam(ctx.request.query.columns),
    );
    const now = Date.now();

    for (const [k, v] of Object.entries(columns)) {
      const e = evaluate(parse(v as string), null, now);
      columns[k] = e;
      for (const p of extractParams(e))
        if (typeof p === "string") options.projection[p] = 1;
    }

    // Exclude temporary tasks and faults
    if (resource === "tasks" || resource === "faults") {
      filter = and(filter, [
        "OR",
        [">=", ["PARAM", "expiry"], Date.now() + 60000],
        ["IS NULL", ["PARAM", "expiry"]],
      ]);
    }

    logger.accessInfo(log);
    ctx.type = "text/csv";
    ctx.attachment(
      `${resource}-${new Date(now).toISOString().replace(/[:.]/g, "")}.csv`,
    );

    ctx.body = Readable.from(
      (async function* () {
        yield Object.keys(columns)
          .map((k) => quoteCsvCell(k))
          .join(",") + "\n";
        for await (const obj of db.query(resource, filter, options)) {
          const arr = Object.values(columns).map((exp) => {
            const v = evaluate(exp, obj, null, (e) => {
              if (Array.isArray(e)) {
                if (e[0] === "PARAM") {
                  if (resource === "devices") {
                    if (e[1] === "Tags") {
                      const tags = [];
                      for (const p in obj)
                        if (p.startsWith("Tags."))
                          tags.push(decodeTag(p.slice(5)));

                      return tags.join(", ");
                    }
                    if (e === exp) {
                      const p = obj[e[1]];
                      if (
                        p &&
                        p.value &&
                        p.value[1] === "xsd:dateTime" &&
                        typeof p.value[0] === "number"
                      )
                        return new Date(p.value[0]).toJSON();
                    }
                  } else if (resource === "faults") {
                    if (e[1] === "detail") return yamlStringify(obj["detail"]);
                  }
                } else if (e[0] === "FUNC") {
                  if (e[1] === "DATE_STRING") {
                    if (e[2] && !Array.isArray(e[2]))
                      return new Date(e[2]).toJSON();
                  }
                }
              }

              return e;
            });

            if (Array.isArray(v) || v == null) return "";
            if (typeof v === "string") return quoteCsvCell(v);
            return v;
          });
          yield arr.join(",") + "\n";
        }
      })(),
    );
  });

  router.head(`/${resource}/:id`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const log = {
      message: `Count ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`,
    };

    const filter = and(authorizer.getFilter(resource, 2), [
      "=",
      ["PARAM", RESOURCE_IDS[resource]],
      ctx.params.id,
    ]);
    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    const count = await db.count(resource, filter);

    if (!count) return void (ctx.status = 404);

    logger.accessInfo(log);
    ctx.body = "";
  });

  router.get(`/${resource}/:id`, async (ctx) => {
    const authorizer: Authorizer = ctx.state.authorizer;
    const log = {
      message: `Query ${resource}`,
      context: ctx,
      filter: `${RESOURCE_IDS[resource]} = "${ctx.params.id}"`,
    };

    const filter = and(authorizer.getFilter(resource, 2), [
      "=",
      ["PARAM", RESOURCE_IDS[resource]],
      ctx.params.id,
    ]);
    if (!authorizer.hasAccess(resource, 2)) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }

    const { value: res } = await db.query(resource, filter).next();

    if (!res) return void (ctx.status = 404);

    logger.accessInfo(log);
    // Config secrets stay masked server-side; the reveal is a
    // per-request explicit action gated on config:3 (M06-B — the value
    // used to cross to the browser before any reveal).
    if (resource === "config") {
      ctx.body = maskConfigRow(
        res as Record<string, unknown>,
        authorizer.hasAccess("config", 3) &&
          revealRequested(ctx.request.headers["x-reveal-secrets"]),
      );
    } else {
      ctx.body = res;
    }
  });

  if (flags & RESOURCE_DELETE) {
    router.delete(`/${resource}/:id`, async (ctx) => {
      const authorizer: Authorizer = ctx.state.authorizer;
      const log = {
        message: `Delete ${resource}`,
        context: ctx,
        id: ctx.params.id,
      };

      const filter = and(authorizer.getFilter(resource, 3), [
        "=",
        ["PARAM", RESOURCE_IDS[resource]],
        ctx.params.id,
      ]);
      if (!authorizer.hasAccess(resource, 3)) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }
      const { value: res } = await db.query(resource, filter).next();
      if (!res) return void (ctx.status = 404);

      const validate = authorizer.getValidator(resource, res);
      if (!validate("delete")) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }

      // Last-admin guard: deleting the final account whose roles grant
      // users:3 would lock every installation administrator out (the
      // runbook recovery requires direct database access). The count
      // AND the delete run inside the shared user-guard lock —
      // releasing before the delete let two parallel deletes of the
      // last two admins both pass the invariant.
      if (resource === "users") {
        try {
          await withLastAdminGuard(async () => {
            const remaining = await countAdminsAfter([ctx.params.id]);
            if (remaining < 1) throw new LastAdminError();
            await apiFunctions.deleteResource(resource, ctx.params.id);
            return { remainingAdmins: remaining };
          });
        } catch (err) {
          log.message += " refused (last admin)";
          logger.accessWarn(log);
          sendSafeLegacyError(
            ctx,
            (err as { status?: number }).status ?? 409,
            "last_admin_refused",
            "Menghapus admin terakhir ditolak. Pulihkan lewat runbook reset admin.",
          );
          return;
        }

        logger.accessInfo(log);
        // Audit: resource + id + config revision only (never the body).
        getEngineAppLogger().emit({
          event: "admin.resource.updated",
          level: "info",
          message: `deleted ${resource}/${ctx.params.id}`,
          actorId: ctx.state.user?.username,
          details: {
            resource,
            id: ctx.params.id,
            revision: ctx.state.configSnapshot,
          },
        });
        ctx.body = "";
        return;
      }

      try {
        await apiFunctions.deleteResource(resource, ctx.params.id);
      } catch (err) {
        if (err instanceof ResourceLockedError) {
          log.message += " failed";
          logger.accessWarn(log);
          sendSafeLegacyError(
            ctx,
            503,
            "resource_locked",
            "The resource is locked by another operation; retry shortly.",
          );
          return;
        }
        throw err;
      }

      logger.accessInfo(log);
      // Audit: resource + id + config revision only (never the body).
      getEngineAppLogger().emit({
        event: "admin.resource.updated",
        level: "info",
        message: `deleted ${resource}/${ctx.params.id}`,
        actorId: ctx.state.user?.username,
        details: {
          resource,
          id: ctx.params.id,
          revision: ctx.state.configSnapshot,
        },
      });

      ctx.body = "";
    });
  }

  if (flags & RESOURCE_PUT) {
    router.put(`/${resource}/:id`, async (ctx) => {
      const authorizer: Authorizer = ctx.state.authorizer;
      const id = ctx.params.id;

      const log = {
        message: `Put ${resource}`,
        context: ctx,
        id: id,
      };

      if (!authorizer.hasAccess(resource, 3)) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }

      const obj = ctx.request.body;

      const validate = authorizer.getValidator(resource, obj);
      if (!validate("put")) {
        logUnauthorizedWarning(log);
        return void (ctx.status = 403);
      }

      // Writing the mask sentinel back would destroy the credential it
      // hides (the editor is readOnly while masked; this guards the API
      // itself — M06-B).
      if (
        resource === "config" &&
        (obj as { value?: unknown }).value === SECRET_MASK
      ) {
        log.message += " refused (masked value)";
        logger.accessWarn(log);
        sendSafeLegacyError(
          ctx,
          400,
          "masked_value",
          "Nilai termasking tidak dapat disimpan; tampilkan nilai dulu.",
        );
        return;
      }

      try {
        // Users writes resolve the target THROUGH the caller's filter
        // (out-of-scope = 404) and role changes cannot demote the last
        // admin-capable account (same invariant as the app endpoints).
        // Upstream PUT semantics are create-or-update (putUser
        // upserts): an unknown id still creates when the caller's
        // filter admits the proposed identity — the shipped legacy
        // UI's "Create new user" form depends on it.
        let guardedWriteDone = false;
        if (resource === "users") {
          const scoped = await fetchScopedUser(authorizer, id);
          const creating = scoped == null && userPassesFilter(authorizer, id);
          if (scoped == null && !creating) return void (ctx.status = 404);
          if (scoped != null) {
            const nextRoles = String(
              (obj as { roles?: unknown }).roles ?? scoped.roles,
            );
            // The count AND the write run inside the shared guard
            // lock — the same shape as the delete path: releasing
            // between check and write let two parallel demotions of
            // the last two admins both pass the invariant.
            try {
              await withLastAdminGuard(async () => {
                const remaining = await countAdminsAfter(
                  [],
                  new Map([[id, nextRoles]]),
                );
                if (remaining < 1) throw new LastAdminError();
                await apiFunctions.putResource(resource, id, obj);
                return { remainingAdmins: remaining };
              });
              guardedWriteDone = true;
            } catch (err) {
              if (err instanceof LastAdminError) {
                log.message += " refused (last admin)";
                logger.accessWarn(log);
                sendSafeLegacyError(
                  ctx,
                  (err as { status?: number }).status ?? 409,
                  "last_admin_refused",
                  "Mengubah admin terakhir ditolak. Pulihkan lewat runbook reset admin.",
                );
                return;
              }
              throw err;
            }
          }
        }
        if (!guardedWriteDone)
          await apiFunctions.putResource(resource, id, obj);
      } catch (err) {
        log.message += " failed";
        logger.accessWarn(log);
        // Parse-only script validation failures already carry a safe
        // message (code + position/size only); every other failure gets a
        // fixed allowlisted text. The response is text/plain with nosniff
        // so reflected text is never rendered as HTML.
        if (
          err instanceof Error &&
          (err as { code?: string }).code === "VALIDATION"
        ) {
          sendSafeLegacyError(
            ctx,
            (err as { exposeStatus?: number }).exposeStatus ?? 400,
            "validation_failed",
            err.message,
          );
        } else {
          sendSafeLegacyError(
            ctx,
            400,
            "put_failed",
            "The resource could not be updated.",
          );
        }
        return;
      }

      logger.accessInfo(log);
      getEngineAppLogger().emit({
        event: "admin.resource.updated",
        level: "info",
        message: `updated ${resource}/${id}`,
        actorId: ctx.state.user?.username,
        details: { resource, id, revision: ctx.state.configSnapshot },
      });

      ctx.body = "";
    });
  }
}

router.get("/blob/files/:id", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const resource = "files";
  const id = ctx.params.id;

  const log = {
    message: `Download ${resource}`,
    context: ctx,
    id: id,
  };

  const filter = and(authorizer.getFilter(resource, 2), [
    "=",
    ["PARAM", RESOURCE_IDS[resource]],
    ctx.params.id,
  ]);

  if (!authorizer.hasAccess(resource, 2)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const count = await db.count(resource, filter);
  if (!count) return void (ctx.status = 404);

  logger.accessInfo(log);

  // Single-range download support (M06-C): the Range header is parsed
  // server-side; an unsatisfiable range answers 416, everything else
  // streams the slice with 206/Content-Range.
  const rangeHeader = singleParam(ctx.request.headers["range"]) ?? "";
  const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (range && (range[1] !== "" || range[2] !== "")) {
    const doc = (await collections.files.findOne({
      _id: id,
    })) as unknown as { length?: number } | null;
    const size = typeof doc?.length === "number" ? doc.length : 0;
    // Suffix ranges (`bytes=-N`) name the LAST N bytes; open ranges
    // (`bytes=N-`) run to the end.
    const suffix = range[1] === "";
    const start = suffix
      ? Math.max(0, size - (Number(range[2]) || 0))
      : Number(range[1]);
    const end = suffix
      ? Math.max(0, size - 1)
      : range[2] === ""
        ? Math.max(0, size - 1)
        : Math.min(Number(range[2]), Math.max(0, size - 1));
    if (!(size > 0) || start > end || start >= size) {
      ctx.status = 416;
      ctx.set("Content-Range", `bytes */${size}`);
      return;
    }
    ctx.status = 206;
    ctx.set("Content-Range", `bytes ${start}-${end}/${size}`);
    ctx.set("Accept-Ranges", "bytes");
    ctx.set("Content-Length", String(end - start + 1));
    ctx.body = db.downloadFileRange(id, start, end);
    return;
  }

  ctx.set("Accept-Ranges", "bytes");
  ctx.body = db.downloadFile(id);
  ctx.attachment(id);
});

router.put("/files/:id", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const resource = "files";
  const id = ctx.params.id;

  const log = {
    message: `Upload ${resource}`,
    context: ctx,
    id: id,
    metadata: null,
  };

  if (!authorizer.hasAccess(resource, 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const metadata = {
    fileType: singleParam(ctx.request.headers["metadata-filetype"]) || "",
    oui: singleParam(ctx.request.headers["metadata-oui"]) || "",
    productClass:
      singleParam(ctx.request.headers["metadata-productclass"]) || "",
    version: singleParam(ctx.request.headers["metadata-version"]) || "",
  };

  const validate = authorizer.getValidator(resource, metadata);
  if (!validate("put")) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  // The replacement uploads to a temp GridFS id and only publishes
  // over the old version once the stream completed within the byte
  // cap — an abort or failed stream can no longer destroy the previous
  // version (PR #8 review).
  try {
    await db.replaceFile(id, metadata, ctx.req);
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      log.message += " failed (too large)";
      logger.accessWarn(log);
      sendSafeLegacyError(ctx, 413, "file_too_large", err.message);
      return;
    }
    throw err;
  }
  log.metadata = metadata;
  logger.accessInfo(log);

  ctx.body = "";
});

router.post("/devices/:id/tasks", async (ctx) => {
  const deviceId = ctx.params.id;
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Commit tasks",
    context: ctx,
    deviceId: deviceId,
    tasks: null,
  };

  if (!authorizer.hasAccess("devices", 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const socketTimeout: number = ctx.socket.timeout;

  // Extend socket timeout while waiting for session
  if (socketTimeout) ctx.socket.setTimeout(300000);

  try {
    // Legacy adapter over the shared guarded executor (M05-B): the
    // response shape (statuses array + Connection-Request header) and
    // every legacy status code stay identical; new whitelist and
    // management-WAN guard rejections surface as 400 instead of the old
    // unstructured 500.
    const result = await executeAuthorizedTasks(
      {
        authorizer,
        configSnapshot: ctx.state.configSnapshot,
        username: ctx.state.user?.username ?? null,
      },
      deviceId,
      ctx.request.body as unknown[],
    );

    log.tasks = result.statuses.map((t) => t._id).join(",");
    logger.accessInfo(log);

    ctx.set("Connection-Request", result.connectionRequestStatus || "OK");
    ctx.body = result.statuses;
  } catch (err) {
    if (err instanceof CommandExecutionError) {
      log.message += " failed";
      logger.accessWarn(log);
      if (err.status === 403) {
        emitPermissionDenied(ctx, "Commit tasks");
        return void (ctx.status = 403);
      }
      if (err.status === 404) return void (ctx.status = 404);
      if (err.status === 503) {
        // Koa serves bare string bodies as text/html; engine rejection
        // text goes through the safe text/plain + nosniff envelope.
        sendSafeLegacyError(ctx, 503, "tasks_overloaded", err.message);
        return;
      }
      sendSafeLegacyError(ctx, 400, "tasks_rejected", err.message);
      return;
    }
    throw err;
  } finally {
    // Restore socket timeout
    if (socketTimeout) ctx.socket.setTimeout(socketTimeout);
  }
});

router.post("/devices/:id/tags", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const log = {
    message: "Update tags",
    context: ctx,
    deviceId: ctx.params.id,
    tags: ctx.request.body,
  };

  const filter = and(authorizer.getFilter("devices", 3), [
    "=",
    ["PARAM", "DeviceID.ID"],
    ctx.params.id,
  ]);
  if (!authorizer.hasAccess("devices", 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }
  const { value: res } = await db.query("devices", filter).next();
  if (!res) return void (ctx.status = 404);

  const validate = authorizer.getValidator("devices", res);
  if (!validate("tags", ctx.request.body)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  try {
    await db.updateDeviceTags(
      ctx.params.id,
      ctx.request.body as Record<string, boolean>,
    );
  } catch (error) {
    log.message += " failed";
    logger.accessWarn(log);
    sendSafeLegacyError(
      ctx,
      400,
      "tags_update_failed",
      "The device tags could not be updated.",
    );
    return;
  }

  logger.accessInfo(log);

  ctx.body = "";
});

router.get("/ping/:host", async (ctx) => {
  if (!ctx.state.user) return void (ctx.status = 401);
  return new Promise<void>((resolve) => {
    ping(ctx.params.host, (err, parsed) => {
      if (parsed) {
        ctx.body = parsed;
      } else {
        ctx.status = 500;
        ctx.body = err ? `${err.name}: ${err.message}` : "Unknown error";
      }
      resolve();
    });
  });
});

router.put("/users/:id/password", async (ctx) => {
  const authorizer: Authorizer = ctx.state.authorizer;
  const username = ctx.params.id;
  const log = {
    message: "Change password",
    context: ctx,
    username: username,
  };

  if (!ctx.state.user) {
    // User not logged in
    if (
      !(await apiFunctions.authLocal(
        ctx.state.configSnapshot,
        username,
        (ctx.request.body as { authPassword?: string }).authPassword,
      ))
    ) {
      logUnauthorizedWarning(log);
      ctx.status = 401;
      ctx.body = "Authentication failed, check your username and password";
      return;
    }
  } else if (!authorizer.hasAccess("users", 3)) {
    logUnauthorizedWarning(log);
    return void (ctx.status = 403);
  }

  const newPassword = (ctx.request.body as { newPassword?: string })
    .newPassword;

  if (ctx.state.user) {
    const filter = and(authorizer.getFilter("users", 3), [
      "=",
      ["PARAM", RESOURCE_IDS.users],
      username,
    ]);
    const { value: res } = await db.query("users", filter).next();
    if (!res) return void (ctx.status = 404);
    const validate = authorizer.getValidator("users", res);
    if (!validate("password", { password: newPassword })) {
      logUnauthorizedWarning(log);
      return void (ctx.status = 403);
    }
  }

  const salt = await generateSalt(64);
  const password = await hashPassword(newPassword, salt);
  await db.putUser(username, { password, salt });

  await del("ui-local-cache-hash");

  logger.accessInfo(log);
  ctx.body = "";
});
