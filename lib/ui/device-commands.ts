// Guarded device-task executor (M05-B). Extracts the native flow from
// the legacy POST /devices/:id/tasks route — Authorizer/filter/
// validator/lock/insertion/connection-request/await-session/removal —
// so the legacy route and the app endpoint run the SAME code. New
// server-side guarantees before any task is inserted: app-contract
// whitelist validation (typed SPV tuples, max 100) and the
// management-WAN guard from M05-B's predecessor. Idempotency goes
// through lib/ui/operation-store.ts (unique operationId + HMAC
// fingerprint); a crashed in_progress operation becomes "unknown" and
// is never replayed.

import { ObjectId } from "mongodb";
import { and } from "../common/expression/util.ts";
import * as apiFunctions from "../api-functions.ts";
import { acquireLock, releaseLock } from "../lock.ts";
import { collections } from "../db/db.ts";
import Authorizer from "../common/authorizer.ts";
import { getConfig } from "./local-cache.ts";
import * as db from "./db.ts";
import { getEngineAppLogger } from "../engine-app-logger.ts";
import {
  validateDeviceCommandTasks,
  type CommandOutcome,
  type CommandPhase,
  type OperationState,
  type TaskInput,
} from "../../packages/app-contracts/src/commands.ts";
import {
  ManagementWanGuardError,
  assertManagementWanSafe,
} from "../../packages/device-profiles/src/management-wan.ts";
import type { WanDevice } from "../../packages/device-profiles/src/wan-types.ts";
import {
  claimOperation,
  completeOperation,
  getOperation,
  operationOutcome,
} from "./operation-store.ts";
import type { AppOperationDoc } from "../db/db.ts";
import { Expression, Task } from "../types.ts";
import { lookup } from "node:dns/promises";

// Typed failure surfaced to route adapters (legacy text semantics or
// the ApiResult envelope) without leaking stacks or upstream bodies.
export class CommandExecutionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandExecutionError";
  }
}

export interface ExecutorContext {
  authorizer: Authorizer;
  configSnapshot: unknown;
  username: string | null;
  requestId?: string;
}

// Resolve the CRURL hostname (when it is not an IP literal) with a
// bounded timeout; failures simply yield no addresses — the guard then
// treats the path as unidentified and blocks destructive mutations.
const defaultResolve = (host: string): Promise<string[]> =>
  lookup(host, { all: true })
    .then((addrs) => addrs.map((a) => a.address))
    .catch(() => []);

export async function resolveCrurlHosts(
  device: WanDevice,
  resolver?: (host: string) => Promise<string[]>,
): Promise<string[]> {
  const raw = value2(
    device,
    "InternetGatewayDevice.ManagementServer.ConnectionRequestURL",
  );
  if (typeof raw !== "string" || !raw) return [];
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return [];
  }
  // IP literals need no resolution.
  if (/^[0-9.]+$/.test(host) || host.includes(":")) return [host];
  try {
    const resolve = resolver ?? defaultResolve;
    return await resolve(host);
  } catch {
    return [];
  }
}

function value2(
  device: WanDevice,
  path: string,
): string | number | boolean | undefined {
  return (device[path] as { value?: [string | number | boolean, string] })
    ?.value?.[0];
}

export interface ExecutorDeps {
  connectionRequest(
    deviceId: string,
    device: Record<string, { value?: [boolean | number | string, string] }>,
  ): Promise<string>;
  awaitSessionStart(
    deviceId: string,
    lastInform: number,
    timeout: number,
  ): Promise<boolean>;
  awaitSessionEnd(deviceId: string, timeout: number): Promise<boolean>;
  insertTasks(tasks: Task[]): Promise<Task[]>;
  deleteTask(id: ObjectId): Promise<unknown>;
  countFaults(deviceId: string, taskId: string): Promise<number>;
  faultCode(deviceId: string, taskId: string): Promise<string | undefined>;
  resolveHosts?(host: string): Promise<string[]>;
}

export const defaultExecutorDeps: ExecutorDeps = {
  connectionRequest: apiFunctions.connectionRequest,
  awaitSessionStart: apiFunctions.awaitSessionStart,
  awaitSessionEnd: apiFunctions.awaitSessionEnd,
  insertTasks: apiFunctions.insertTasks,
  deleteTask: (id) => db.deleteTask(id),
  countFaults: (deviceId, taskId) =>
    collections.faults.countDocuments({
      _id: `${deviceId}:task_${taskId}`,
    }),
  faultCode: async (deviceId, taskId) => {
    const fault = await collections.faults.findOne({
      _id: `${deviceId}:task_${taskId}`,
    });
    return fault?.code;
  },
};

// CR statuses that are a DETERMINISTIC failure (the device path itself
// refused/invalid). Everything else non-empty — "No contact from CPE",
// "Session took too long to complete" — means the outcome could not be
// confirmed: unknown, never success.
const CR_FAILURE_STATUSES = new Set([
  "Connection request failed",
  "Invalid connection request URL",
]);

export function normalizeTaskOutcome(result: {
  status: string;
  tasks: { status: string }[];
}): { state: OperationState } {
  if (result.status) {
    return {
      state: CR_FAILURE_STATUSES.has(result.status) ? "failed" : "unknown",
    };
  }
  const states = result.tasks.map((t) => t.status);
  if (states.some((s) => ["fault", "failed", "error"].includes(s)))
    return { state: "failed" };
  if (states.length && states.every((s) => s === "done"))
    return { state: "succeeded" };
  return { state: "unknown" };
}

export interface TaskExecutionResult {
  state: OperationState;
  phases: CommandPhase[];
  statuses: { _id: string; status: string; faultCode?: string }[];
  // null means the connection request itself was OK.
  connectionRequestStatus: string | null;
  outcome?: CommandOutcome;
  claim?: "new" | "existing";
}

export interface ExecuteOptions {
  operation?: { operationId: string; kind: string; fingerprint: string };
  deps?: Partial<ExecutorDeps>;
}

function deviceOnlineThreshold(
  configSnapshot: unknown,
  device: Record<string, { value?: [unknown, string] }>,
): number {
  return getConfig(
    configSnapshot as string,
    "cwmp.deviceOnlineThreshold",
    {},
    Date.now(),
    (exp): Expression => {
      if (!Array.isArray(exp)) return exp;
      if (exp[0] === "PARAM") {
        const p = device[exp[1] as string];
        if (p?.value) return p.value[0] as Expression;
      } else if (exp[0] === "FUNC") {
        if (exp[1] === "REMOTE_ADDRESS") {
          for (const root of ["InternetGatewayDevice", "Device"]) {
            const p = device[`${root}.ManagementServer.ConnectionRequestURL`];
            if (p?.value) return new URL(String(p.value[0])).hostname;
          }
          return null;
        }
      }
      return exp;
    },
  ) as number;
}

// Whitelisted fields per task name (contracts.md TaskInput): the
// server rebuilds each task from validated input — client _id,
// timestamp and uniqueKey never reach insertTasks, and expiry is
// clamped into the native 1..86400 second band. NaN/negative values
// silently became "already expired" tasks the CPE skips while the UI
// reported success (STD-03).
const TASK_FIELDS: Record<string, Set<string>> = {
  getParameterValues: new Set(["name", "parameterNames"]),
  setParameterValues: new Set(["name", "parameterValues"]),
  refreshObject: new Set(["name", "objectName"]),
  addObject: new Set(["name", "objectName", "parameterValues"]),
  deleteObject: new Set(["name", "objectName"]),
  download: new Set(["name", "fileType", "fileName", "file", "targetFileName"]),
  provisions: new Set(["name", "provisions"]),
  reboot: new Set(["name"]),
  factoryReset: new Set(["name"]),
};

function rebuildTask(input: TaskInput, deviceId: string): Task {
  const allowed = TASK_FIELDS[input.name];
  if (!allowed) throw new Error(`Invalid task name: ${input.name}`);
  const task: Record<string, unknown> = {};
  const source = input as unknown as Record<string, unknown>;
  for (const field of allowed)
    if (source[field] !== undefined) task[field] = source[field];
  // Bound expiry into a sane band; absent stays absent (native default).
  const expiry = (input as { expiry?: number }).expiry;
  if (expiry !== undefined) {
    if (typeof expiry !== "number" || !Number.isFinite(expiry))
      throw new Error("expiry harus number (detik).");
    task["expiry"] = Math.min(86400, Math.max(1, Math.round(expiry)));
  }
  task["device"] = deviceId;
  return task as unknown as Task;
}

export async function executeAuthorizedTasks(
  ctx: ExecutorContext,
  deviceId: string,
  tasks: unknown[],
  options: ExecuteOptions = {},
): Promise<TaskExecutionResult> {
  const deps: ExecutorDeps = { ...defaultExecutorDeps, ...options.deps };
  const log = getEngineAppLogger();

  // 1. Contract whitelist BEFORE anything touches the database or the
  //    authorizer state: unknown names/shapes and >100 tasks never
  //    reach insertTasks (which stays authoritative for the rest).
  const validationErrors = validateDeviceCommandTasks(tasks);
  if (validationErrors.length)
    throw new CommandExecutionError(
      400,
      "VALIDATION",
      validationErrors.join("; "),
    );

  if (!ctx.authorizer.hasAccess("devices", 3))
    throw new CommandExecutionError(403, "FORBIDDEN", "not authorized");

  // 2. Idempotent claim: same operationId + same fingerprint returns
  //    the stored outcome (never a second submission); a different
  //    fingerprint is a conflict.
  if (options.operation) {
    const claim = await claimOperation(
      options.operation.operationId,
      ctx.username ?? "",
      deviceId,
      options.operation.kind,
      options.operation.fingerprint,
    );
    if (claim.claim === "conflict")
      throw new CommandExecutionError(
        409,
        "CONFLICT",
        "operationId sudah dipakai untuk request berbeda",
      );
    if (claim.claim === "existing") {
      // Replay re-authorization: the stored outcome is only visible to
      // the owner (or a logs:2 admin) who can STILL see the target
      // device under their CURRENT permission filter — a revoked or
      // out-of-scope caller gets a 404, never the result.
      const stillAuthorized = await authorizeOperationRead(
        ctx.authorizer,
        claim.operation,
        ctx.username ?? "",
      );
      if (!stillAuthorized)
        throw new CommandExecutionError(404, "NOT_FOUND", "no such device");
      return {
        state: claim.operation.state,
        phases: claim.operation.phases as CommandPhase[],
        statuses: [],
        connectionRequestStatus: null,
        outcome: operationOutcome(claim.operation),
        claim: "existing",
      };
    }
  }

  const operationId = options.operation?.operationId;
  const startedAt = Date.now();
  log.emit({
    event: "device.command.started",
    level: "info",
    message: `device command started for ${deviceId}`,
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(operationId ? { operationId } : {}),
    ...(ctx.username ? { actorId: ctx.username } : {}),
    deviceId,
    details: { taskCount: (tasks as TaskInput[]).length },
  });

  // 3. Serialize concurrent task submissions per device (native lock
  //    semantics preserved: the lock covers validation + insertion).
  const token = await acquireLock(`cwmp_session_${deviceId}`, 5000, 30000);
  if (!token)
    throw new CommandExecutionError(503, "CONFLICT", "Device is in session");

  let device: Record<string, { value?: [unknown, string] }> | null = null;
  let statuses: { _id: string; status: string; faultCode?: string }[] = [];

  try {
    const filter = and(ctx.authorizer.getFilter("devices", 3), [
      "=",
      ["PARAM", "DeviceID.ID"],
      deviceId,
    ]);
    device = (await db.query("devices", filter).next()).value as Record<
      string,
      { value?: [unknown, string] }
    >;
    if (!device)
      throw new CommandExecutionError(404, "NOT_FOUND", "no such device");

    const validate = ctx.authorizer.getValidator("devices", device);
    for (const t of tasks) {
      if (!validate("task", t))
        throw new CommandExecutionError(403, "FORBIDDEN", "not authorized");
    }

    // 4. Management-WAN guard on EVERY relevant task (raw SPV/delete
    //    included) before insertion — the legacy UI only guarded forms.
    //    CRURL hostnames resolve HERE (server-side, bounded) so DNS-based
    //    management paths are identifiable; ambiguity stays ambiguous.
    const resolvedHosts = await resolveCrurlHosts(
      device as unknown as WanDevice,
      options.deps?.resolveHosts,
    );
    try {
      assertManagementWanSafe(
        device as unknown as WanDevice,
        tasks as TaskInput[],
        resolvedHosts,
      );
    } catch (err) {
      if (err instanceof ManagementWanGuardError)
        throw new CommandExecutionError(400, "VALIDATION", err.message);
      throw err;
    }

    const prepared = (tasks as TaskInput[]).map((t) =>
      rebuildTask(t, deviceId),
    );

    const inserted = await deps.insertTasks(prepared);
    statuses = inserted.map((t) => ({ _id: t._id, status: "pending" }));
  } finally {
    await releaseLock(`cwmp_session_${deviceId}`, token);
  }

  // 5. Connection request + session await (outside the insert lock,
  //    exactly like the native route). Cleanup runs in the finally so a
  //    probe failure never leaves attempted tasks behind.
  let status = "";
  try {
    const onlineThreshold = deviceOnlineThreshold(ctx.configSnapshot, device);
    const lastInform = device["Events.Inform"].value[0] as number;

    status = await deps.connectionRequest(
      deviceId,
      device as unknown as Record<
        string,
        { value?: [boolean | number | string, string] }
      >,
    );
    if (!status) {
      const sessionStarted = await deps.awaitSessionStart(
        deviceId,
        lastInform,
        onlineThreshold,
      );
      if (!sessionStarted) {
        status = "No contact from CPE";
      } else {
        const sessionEnded = await deps.awaitSessionEnd(deviceId, 120000);
        if (!sessionEnded) status = "Session took too long to complete";
      }
    }

    if (!status) {
      for (const [i, t] of statuses.entries()) {
        const faults = await deps.countFaults(deviceId, t._id);
        if (faults) {
          statuses[i].status = "fault";
          statuses[i].faultCode = await deps.faultCode(deviceId, t._id);
        } else {
          statuses[i].status = "done";
        }
      }
    }
  } finally {
    // Attempted tasks are always cleaned up (native semantics); on
    // probe failure they stay "pending" in the RESULT while the queued
    // docs are removed.
    await Promise.all(
      statuses.map((t) => deps.deleteTask(new ObjectId(t._id))),
    );
  }

  const { state } = normalizeTaskOutcome({
    status,
    tasks: statuses,
  });
  const phases: CommandPhase[] = [
    {
      name: "execute",
      state,
      taskIds: statuses.map((t) => t._id),
      ...(statuses.find((t) => t.faultCode)
        ? { faultCode: statuses.find((t) => t.faultCode)?.faultCode }
        : {}),
    },
  ];

  let outcome: CommandOutcome | undefined;
  if (operationId) {
    await completeOperation(operationId, state, phases);
    const stored = await getOperation(operationId);
    if (stored) outcome = operationOutcome(stored);
  }

  log.emit({
    event: "device.command.completed",
    level: state === "failed" ? "warn" : "info",
    message: `device command ${state} for ${deviceId}`,
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(operationId ? { operationId } : {}),
    ...(ctx.username ? { actorId: ctx.username } : {}),
    deviceId,
    durationMs: Date.now() - startedAt,
    outcome:
      state === "succeeded"
        ? "success"
        : state === "failed"
          ? "failure"
          : state === "partial"
            ? "partial"
            : "unknown",
    details: {
      taskIds: statuses.map((t) => t._id),
      ...(statuses.find((t) => t.faultCode)
        ? { faultCode: statuses.find((t) => t.faultCode)?.faultCode }
        : {}),
    },
  });

  return {
    state,
    phases,
    statuses,
    connectionRequestStatus: status || null,
    outcome,
    claim: "new",
  };
}

// Result lookup for GET /api/app/operations/:id — permission stays
// server-side: everyone needs devices:2 + the target inside their
// filter; a non-owner additionally needs logs:2.
export async function authorizeOperationRead(
  authorizer: Authorizer,
  operation: AppOperationDoc,
  username: string,
): Promise<boolean> {
  if (!authorizer.hasAccess("devices", 2)) return false;
  const filter = and(authorizer.getFilter("devices", 2), [
    "=",
    ["PARAM", "DeviceID.ID"],
    operation.device,
  ]);
  const visible = await db.count("devices", filter);
  if (!visible) return false;
  if (operation.user === username) return true;
  return authorizer.hasAccess("logs", 2);
}
