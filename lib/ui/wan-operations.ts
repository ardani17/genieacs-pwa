// WAN orchestrator (M05-C): validate/authorize/guard → typed
// write/AddObject → refresh → (bridge binding reapply) → verify, each
// phase recorded in the shared operation store. A failed or unknown
// phase stops every later phase; nothing is ever auto-retried or
// recreated. The browser supplies only WanSettings form values — the
// full task is (re)built server-side from the fresh authorized device.

import Authorizer from "../common/authorizer.ts";
import { and } from "../common/expression/util.ts";
import { acquireLock, releaseLock } from "../lock.ts";
import * as db from "./db.ts";
import { getRevision, getPermissions, getUsers } from "./local-cache.ts";
import { getEngineAppLogger } from "../engine-app-logger.ts";
import {
  CommandExecutionError,
  executeAuthorizedTasks,
  type ExecutorContext,
  type ExecutorDeps,
  type TaskExecutionResult,
} from "./device-commands.ts";
import {
  claimOperation,
  completeOperation,
  getOperation,
  operationOutcome,
  requestFingerprint,
} from "./operation-store.ts";
import {
  buildWanTask,
  connections,
  value as wanValue,
  WAN_COLLECTION,
} from "../../packages/device-profiles/src/wan-model.ts";
import type {
  WanDevice,
  WanTask,
} from "../../packages/device-profiles/src/wan-types.ts";
import { resolveProfile } from "../../packages/device-profiles/src/resolve.ts";
import type {
  CommandPhase,
  OperationState,
} from "../../packages/app-contracts/src/commands.ts";
import type {
  WanOperationOutcome,
  WanOperationRequest,
} from "../../packages/app-contracts/src/wan.ts";

export type { WanOperationRequest } from "../../packages/app-contracts/src/wan.ts";

// Deterministic phase runner for tests and the real flow alike:
// write → refresh → reapplyBinding. A failed/unknown write stops
// everything; a failed/unknown later phase leaves the partially applied
// work as "partial".
export interface WanPhaseSteps {
  write(): Promise<{ state: OperationState }>;
  refresh(): Promise<{ state: OperationState }>;
  reapplyBinding(): Promise<{ state: OperationState }>;
}

export async function runWanPhases(
  steps: WanPhaseSteps,
): Promise<{ state: OperationState }> {
  const write = await steps.write();
  if (write.state === "failed" || write.state === "unknown")
    return { state: write.state };
  const refresh = await steps.refresh();
  if (refresh.state !== "succeeded") return { state: "partial" };
  const binding = await steps.reapplyBinding();
  if (binding.state !== "succeeded") return { state: "partial" };
  return { state: "succeeded" };
}

async function fetchAuthorizedDevice(
  authorizer: Authorizer,
  deviceId: string,
): Promise<WanDevice | null> {
  const filter = and(authorizer.getFilter("devices", 3), [
    "=",
    ["PARAM", "DeviceID.ID"],
    deviceId,
  ]);
  const { value } = await db.query("devices", filter).next();
  return (value as unknown as WanDevice) ?? null;
}

// Re-check permission from the CURRENT local-cache snapshot before any
// follow-up phase: a permission change mid-operation stops it as
// partial rather than continuing with stale rights.
async function reauthorize(ctx: ExecutorContext): Promise<Authorizer | null> {
  if (!ctx.username) return null;
  const snapshot = await getRevision();
  const user = getUsers(snapshot)[ctx.username];
  if (!user) return null;
  const allPermissions = getPermissions(snapshot);
  // Cached users keep roles as a comma-separated string (native shape).
  const roles = String(user.roles).split(",");
  const permissionSets = roles.map((r) =>
    Object.values(allPermissions[r] || {}),
  );
  return new Authorizer(permissionSets);
}

const TRUTHY = [true, 1, "1", "true"];

function writtenValueMatches(
  fresh: WanDevice,
  path: string,
  expected: string | number | boolean,
): boolean {
  const actual = wanValue(fresh, path);
  if (typeof actual === "boolean" || typeof expected === "boolean")
    return TRUTHY.includes(actual) === TRUTHY.includes(expected);
  return String(actual ?? "") === String(expected);
}

// Verify the values this task wrote are visible on a fresh read
// (passwords are never read back).
function verifyTaskApplied(
  fresh: WanDevice,
  instance: string,
  task: WanTask,
): boolean {
  for (const [name, expected] of task.parameterValues) {
    if (/\.?Password$/.test(name)) continue;
    const path = name.includes(".") ? name : `${instance}.${name}`;
    if (!writtenValueMatches(fresh, path, expected)) return false;
  }
  return true;
}

export interface WanExecuteOptions {
  deps?: Partial<ExecutorDeps>;
}

export async function executeWanOperation(
  ctx: ExecutorContext,
  request: WanOperationRequest,
  options: WanExecuteOptions = {},
): Promise<WanOperationOutcome> {
  const log = getEngineAppLogger();
  const { operationId, deviceId, collection, instance, settings } = request;

  if (!WAN_COLLECTION.test(collection))
    throw new CommandExecutionError(
      400,
      "VALIDATION",
      "collection bukan koleksi WAN TR-098",
    );

  // Idempotency through the shared store: same body returns the stored
  // outcome; a different body under the same id conflicts.
  const fingerprint = requestFingerprint({
    deviceId,
    collection,
    instance,
    settings,
  });
  const claim = await claimOperation(
    operationId,
    ctx.username ?? "",
    deviceId,
    "wan",
    fingerprint,
  );
  if (claim.claim === "conflict")
    throw new CommandExecutionError(
      409,
      "CONFLICT",
      "operationId sudah dipakai untuk request berbeda",
    );
  if (claim.claim === "existing")
    return {
      ...operationOutcome(claim.operation),
      warnings: [],
    };

  const warnings: string[] = [];
  const phases: CommandPhase[] = [];

  // One WAN operation per device+collection at a time.
  const wanLock = `wan_${deviceId}_${collection}`;
  const lockToken = await acquireLock(wanLock, 5000, 30000);
  if (!lockToken)
    throw new CommandExecutionError(
      409,
      "CONFLICT",
      "Operasi WAN lain sedang berjalan pada target ini",
    );

  const run = async (
    authorizer: Authorizer,
    tasks: unknown[],
  ): Promise<TaskExecutionResult> =>
    executeAuthorizedTasks({ ...ctx, authorizer }, deviceId, tasks, {
      deps: options.deps,
    });

  try {
    if (!ctx.authorizer.hasAccess("devices", 3))
      throw new CommandExecutionError(403, "FORBIDDEN", "not authorized");

    const device = await fetchAuthorizedDevice(ctx.authorizer, deviceId);
    if (!device)
      throw new CommandExecutionError(404, "NOT_FOUND", "no such device");

    const profile = resolveProfile(device);
    if (!profile.wan)
      throw new CommandExecutionError(
        400,
        "UNSUPPORTED_PROFILE",
        "Profil firmware ini belum terverifikasi untuk tulis WAN",
      );

    // Build the COMPLETE task server-side; client payload is only form
    // settings, never parameter tuples.
    let task: WanTask;
    try {
      task = buildWanTask(device, collection, instance, settings);
    } catch (err) {
      throw new CommandExecutionError(
        400,
        "VALIDATION",
        (err as Error).message,
      );
    }

    const before = connections(device);
    const bridge = task.parameterValues.some(
      ([n, v]) =>
        (n === "ConnectionType" || n.endsWith(".ConnectionType")) &&
        /_Bridged$/i.test(String(v)),
    );

    // --- phase: write (exactly once) ---
    const write = await run(ctx.authorizer, [task]);
    phases.push({
      name: "write",
      state: write.state,
      taskIds: write.statuses.map((t) => t._id),
      ...(write.statuses.find((t) => t.faultCode)
        ? { faultCode: write.statuses.find((t) => t.faultCode)?.faultCode }
        : {}),
    });
    if (write.state === "failed" || write.state === "unknown") {
      return await finish(operationId, deviceId, write.state, phases, warnings);
    }

    // --- permission re-check before follow-up phases ---
    const reauth = await reauthorize(ctx);
    if (!reauth || !reauth.hasAccess("devices", 3)) {
      warnings.push(
        "Izin berubah selama operasi; fase lanjutan dihentikan (partial).",
      );
      return await finish(operationId, deviceId, "partial", phases, warnings);
    }

    // --- phase: refresh the WAN tree and match reality ---
    const refresh = await run(reauth, [
      { name: "refreshObject", objectName: collection },
    ]);
    const freshDevice = await fetchAuthorizedDevice(reauth, deviceId);
    phases.push({
      name: "refresh",
      state: refresh.state,
      taskIds: refresh.statuses.map((t) => t._id),
    });
    if (refresh.state !== "succeeded") {
      // Write applied, confirmation missing: partial, no follow-up.
      return await finish(operationId, deviceId, "partial", phases, warnings);
    }

    // Resolve the effective instance: AddObject creates a new one we
    // must identify from the refreshed tree (never create a second
    // object to replace an unconfirmed one).
    let effectiveInstance = instance;
    let observedInstance: string | undefined;
    if (!instance) {
      const after = freshDevice ? connections(freshDevice) : [];
      const created = after.filter((p) => !before.includes(p));
      if (created.length === 1) {
        effectiveInstance = created[0];
        observedInstance = created[0];
      } else {
        warnings.push(
          "Instance baru tidak dapat diidentifikasi unik. Jalankan refresh dan lanjutkan manual; objek tidak dibuat ulang.",
        );
        return await finish(
          operationId,
          deviceId,
          "partial",
          phases,
          warnings,
          observedInstance,
        );
      }
      // An AddObject that landed empty/disabled is a partial result.
      const name = String(
        wanValue(freshDevice!, `${effectiveInstance}.Name`) ?? "",
      );
      const enabled = TRUTHY.includes(
        wanValue(freshDevice!, `${effectiveInstance}.Enable`),
      );
      if (!name.trim() || !enabled) {
        warnings.push(
          `Instance ${effectiveInstance} terbentuk tetapi belum aktif/terisi. Lengkapi lewat editor; objek tidak dibuat ulang.`,
        );
        return await finish(
          operationId,
          deviceId,
          "partial",
          phases,
          warnings,
          observedInstance,
        );
      }
    }

    // --- phase: reapply binding when converting to bridge ---
    if (bridge) {
      const desiredBind = settings.lanBind
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(",");
      const currentBind = String(
        wanValue(freshDevice!, `${effectiveInstance}.X_ZTE-COM_LanInterface`) ??
          "",
      );
      if (desiredBind && currentBind !== desiredBind) {
        const reapply = await run(reauth, [
          {
            name: "setParameterValues",
            parameterValues: [
              [
                `${effectiveInstance}.X_ZTE-COM_LanInterface`,
                desiredBind,
                "xsd:string",
              ],
            ],
          },
        ]);
        phases.push({
          name: "reapply_binding",
          state: reapply.state,
          taskIds: reapply.statuses.map((t) => t._id),
        });
        if (reapply.state !== "succeeded") {
          return await finish(
            operationId,
            deviceId,
            "partial",
            phases,
            warnings,
            observedInstance,
          );
        }
      }
    }

    // --- phase: verify on a fresh read ---
    const verifyDevice = await fetchAuthorizedDevice(reauth, deviceId);
    const verified =
      verifyDevice != null &&
      verifyTaskApplied(verifyDevice, effectiveInstance!, task) &&
      (!bridge ||
        !settings.lanBind ||
        String(
          wanValue(
            verifyDevice,
            `${effectiveInstance}.X_ZTE-COM_LanInterface`,
          ) ?? "",
        ) ===
          settings.lanBind
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .join(","));
    phases.push({
      name: "verify",
      state: verified ? "succeeded" : "failed",
      taskIds: [],
    });
    if (!verified) {
      warnings.push(
        "Nilai hasil tulis belum terbaca sama pada verifikasi; periksa manual.",
      );
      return await finish(
        operationId,
        deviceId,
        "partial",
        phases,
        warnings,
        observedInstance,
      );
    }

    // --- superseded 9003 fault cleanup (scoped, permission-gated) ---
    await cleanupSupersededFaults(ctx, deviceId, phases, warnings, log);

    return await finish(
      operationId,
      deviceId,
      "succeeded",
      phases,
      warnings,
      observedInstance,
    );
  } finally {
    await releaseLock(wanLock, lockToken);
  }
}

// Only faults tied to THIS operation's tasks (or its virtual PPP
// channel) with superseded 9003 codes are ever considered, and only
// with faults:3 + the native validator. Otherwise they are retained
// with a visible warning.
async function cleanupSupersededFaults(
  ctx: ExecutorContext,
  deviceId: string,
  phases: CommandPhase[],
  warnings: string[],
  log: ReturnType<typeof getEngineAppLogger>,
): Promise<void> {
  const taskIds = phases.flatMap((p) => p.taskIds);
  if (!taskIds.length) return;
  try {
    if (!ctx.authorizer.hasAccess("faults", 3)) {
      warnings.push(
        "Fault 9003 tersisa tidak dibersihkan (butuh izin faults:3).",
      );
      return;
    }
    const { collections } = await import("../db/db.ts");
    const faultIds = taskIds.map((id) => `${deviceId}:task_${id}`);
    const candidates = await collections.faults
      .find({ _id: { $in: faultIds }, code: "9003" })
      .toArray();
    if (!candidates.length) return;
    // The native per-object validator decides each deletion; anything
    // it refuses stays visible.
    const deletable: string[] = [];
    for (const fault of candidates) {
      const validate = ctx.authorizer.getValidator("faults", fault);
      if (validate("delete")) deletable.push(fault._id);
    }
    if (deletable.length) {
      const removed = await collections.faults.deleteMany({
        _id: { $in: deletable },
      });
      if (removed.deletedCount)
        log.emit({
          event: "device.wan.phase",
          level: "info",
          message: `cleaned ${removed.deletedCount} superseded fault(s)`,
          deviceId,
          details: { removed: removed.deletedCount },
        });
    }
    if (deletable.length < candidates.length)
      warnings.push(
        `${candidates.length - deletable.length} fault 9003 dipertahankan validator.`,
      );
  } catch {
    warnings.push("Pembersihan fault 9003 gagal; fault dipertahankan.");
  }
}

async function finish(
  operationId: string,
  deviceId: string,
  state: OperationState,
  phases: CommandPhase[],
  warnings: string[],
  observedInstance?: string,
): Promise<WanOperationOutcome> {
  await completeOperation(operationId, state, phases);
  const stored = await getOperation(operationId);
  const outcome = stored
    ? operationOutcome(stored)
    : { operationId, deviceId, state, phases };
  return {
    ...outcome,
    ...(observedInstance ? { observedInstance } : {}),
    warnings,
  };
}
