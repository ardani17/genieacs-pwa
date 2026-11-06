// app_operations store (contracts.md): unique operationId, user,
// device, kind, HMAC request fingerprint, phase results and a 24h TTL.
// This is an idempotency/diagnosis record — never a durable work queue.
// Claiming is atomic: the same operationId + same fingerprint returns
// the stored outcome; a different fingerprint for the same id is a
// conflict (409). Operations that were in_progress when a process died
// become "unknown" (lazily, on first store access of the new process) —
// they are never replayed.

import { createHmac } from "node:crypto";
import { collections, type AppOperationDoc } from "../db/db.ts";
import type {
  CommandPhase,
  OperationState,
} from "../../packages/app-contracts/src/commands.ts";
import { getEngineAppLogger } from "../engine-app-logger.ts";

const OPERATION_TTL_MS = 24 * 60 * 60 * 1000;

// Start-of-process watermark: anything still in_progress with an
// updatedAt BEFORE this moment belonged to a dead process.
const PROCESS_STARTED_AT = new Date();

let ensured: Promise<void> | null = null;

// Mark operations that were in_progress BEFORE this process started as
// unknown. Called lazily once per process (public so tests can drive it
// deterministically).
export async function sweepStaleOperations(): Promise<number> {
  const res = await collections.appOperations.updateMany(
    { state: "in_progress", updatedAt: { $lt: PROCESS_STARTED_AT } },
    { $set: { state: "unknown", updatedAt: new Date() } },
  );
  if (res.modifiedCount)
    getEngineAppLogger().emit({
      event: "device.command.recovered",
      level: "warn",
      message: `marked ${res.modifiedCount} orphaned operation(s) unknown at startup`,
      details: { recovered: res.modifiedCount },
    });
  return res.modifiedCount;
}

function ensureSwept(): Promise<void> {
  if (ensured == null) {
    ensured = sweepStaleOperations()
      .catch(() => {
        // Non-fatal: claims still work; the sweep retries next process.
        ensured = null;
      })
      .then(() => undefined);
  }
  return ensured;
}

// Canonical JSON: object keys sorted recursively, array order
// preserved — the same logical request from any serializer produces
// the same fingerprint (raw JSON.stringify inherits key order, so a
// reordered-but-equal replay used to 409).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort())
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

// One-way fingerprint of the canonical request body. Secret task values
// (e.g. PPP passwords inside SPV tuples) never reach storage — only the
// HMAC does — and the canonical body itself is never logged.
export function requestFingerprint(body: unknown): string {
  const key =
    (process.env["GENIEACS_UI_JWT_SECRET"] as string | undefined) ??
    "app-operations-fingerprint";
  return createHmac("sha256", key)
    .update(JSON.stringify(canonicalize(body)))
    .digest("hex");
}

// Pre-canonicalization fingerprint (raw JSON key order) — callers
// pass it alongside the canonical one for TTL-window compat.
export function legacyRequestFingerprint(body: unknown): string {
  const key =
    (process.env["GENIEACS_UI_JWT_SECRET"] as string | undefined) ??
    "app-operations-fingerprint";
  return createHmac("sha256", key).update(JSON.stringify(body)).digest("hex");
}

export type ClaimResult =
  | { claim: "new"; operation: AppOperationDoc }
  | { claim: "existing"; operation: AppOperationDoc }
  | { claim: "conflict"; operation: AppOperationDoc };

export async function claimOperation(
  operationId: string,
  user: string,
  device: string,
  kind: string,
  fingerprint: string,
  legacyFingerprints: string[] = [],
): Promise<ClaimResult> {
  await ensureSwept();
  const now = new Date();
  const res = await collections.appOperations.findOneAndUpdate(
    { _id: operationId },
    {
      $setOnInsert: {
        user,
        device,
        kind,
        fingerprint,
        state: "in_progress",
        phases: [],
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + OPERATION_TTL_MS),
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      includeResultMetadata: true,
    },
  );
  const inserted = res.lastErrorObject?.upserted != null;
  const operation = res.value as AppOperationDoc;
  if (inserted) return { claim: "new", operation };
  // Canonical fingerprints replaced the raw-JSON order on 2026-11-06;
  // records claimed before that carry the legacy HMAC — accept both
  // until the 24h TTL retires them (plan: compat until TTL).
  if (
    operation.fingerprint === fingerprint ||
    legacyFingerprints.includes(operation.fingerprint)
  )
    return { claim: "existing", operation };
  return { claim: "conflict", operation };
}

export async function getOperation(
  operationId: string,
): Promise<AppOperationDoc | null> {
  await ensureSwept();
  return collections.appOperations.findOne({ _id: operationId });
}

// Drop a claim that never started device work (e.g. lock contention
// before the first phase ran) so the client's retry re-executes
// instead of replaying a dead in_progress record. The state filter
// keeps a completed record intact if a concurrent writer finalized it
// first.
export async function deleteOperation(operationId: string): Promise<void> {
  await collections.appOperations.deleteOne({
    _id: operationId,
    state: "in_progress",
  });
}

// Record phase progress atomically (STD-04): $set phases only — the
// operation state stays whatever completeOperation last wrote, and a
// concurrent lookup sees coherent per-phase progress without replay.
export async function recordPhases(
  operationId: string,
  phases: CommandPhase[],
): Promise<void> {
  await collections.appOperations.updateOne(
    { _id: operationId },
    { $set: { phases, updatedAt: new Date() } },
  );
}

export async function completeOperation(
  operationId: string,
  state: OperationState,
  phases: CommandPhase[],
  extras: { warnings?: string[]; observedInstance?: string } = {},
): Promise<void> {
  await collections.appOperations.updateOne(
    { _id: operationId },
    {
      $set: {
        state,
        phases,
        updatedAt: new Date(),
        ...(extras.warnings ? { warnings: extras.warnings } : {}),
        ...(extras.observedInstance
          ? { observedInstance: extras.observedInstance }
          : {}),
      },
    },
  );
}

export function operationOutcome(
  operation: AppOperationDoc,
): import("../../packages/app-contracts/src/commands.ts").CommandOutcome {
  return {
    operationId: operation._id,
    deviceId: operation.device,
    state: operation.state,
    phases: operation.phases as CommandPhase[],
    // Persisted follow-up notes travel WITH the record so POST, replay
    // and GET all return identical evidence.
    ...(operation.warnings?.length ? { warnings: operation.warnings } : {}),
    ...(operation.observedInstance
      ? { observedInstance: operation.observedInstance }
      : {}),
  };
}
