import { getEngineAppLogger } from "../engine-app-logger.ts";
import { controllerRequest } from "./vpn-controller.ts";
import type { LoggerStatus } from "../../packages/app-contracts/src/log.ts";

export function vectorCounters(text: string): {
  bufferBytes: number;
  droppedEvents: number;
  errors: number;
} {
  let bufferBytes = 0,
    droppedEvents = 0,
    errors = 0;
  for (const line of text.split("\n")) {
    const match = /^(?:vector_)?([a-z_]+)(?:\{[^\n]*\})?\s+([0-9.e+]+)$/.exec(
      line,
    );
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    if (match[1] === "buffer_size_bytes" || match[1] === "buffer_byte_size")
      bufferBytes += value;
    if (
      match[1] === "component_discarded_events_total" ||
      match[1] === "buffer_discarded_events_total"
    )
      droppedEvents += value;
    if (
      match[1] === "component_errors_total" ||
      match[1] === "buffer_errors_total"
    )
      errors += value;
  }
  return { bufferBytes, droppedEvents, errors };
}
export function storageMetrics(text: string): {
  usedBytes: number | null;
  freeBytes: number | null;
  level: "unknown" | "normal" | "warning" | "critical";
} {
  let usedBytes: number | null = null,
    freeBytes: number | null = null;
  for (const line of text.split("\n")) {
    const size =
      /^vl_data_size_bytes\{type="(?:storage|indexdb)"\}\s+([0-9.e+]+)$/.exec(
        line,
      );
    if (size && Number.isFinite(Number(size[1])))
      usedBytes = (usedBytes ?? 0) + Number(size[1]);
    const free = /^vl_free_disk_space_bytes(?:\{[^\n]*\})?\s+([0-9.e+]+)$/.exec(
      line,
    );
    if (free && Number.isFinite(Number(free[1])))
      freeBytes =
        freeBytes == null
          ? Number(free[1])
          : Math.min(freeBytes, Number(free[1]));
  }
  const level =
    usedBytes == null || freeBytes == null
      ? "unknown"
      : freeBytes < 2 * 1024 ** 3 || usedBytes >= 9000000000
        ? "critical"
        : usedBytes >= 8000000000
          ? "warning"
          : "normal";
  return { usedBytes, freeBytes, level };
}
let degradedSince: string | null = null,
  lastSuccessAt: string | null = null,
  lastErrors = 0,
  lastDrops = 0;
export async function loggingStatus(requestId: string): Promise<object> {
  const local = getEngineAppLogger().status();
  const sink = process.env.LOG_URL,
    metrics = process.env.VECTOR_METRICS_URL;
  const [sinkReachable, collector, vpn, storage] = await Promise.all([
    sink
      ? fetch(sink + "/health", { signal: AbortSignal.timeout(1500) })
          .then((r) => r.ok)
          .catch(() => false)
      : false,
    metrics
      ? fetch(metrics, { signal: AbortSignal.timeout(1500) })
          .then(async (r) => {
            if (!r.ok) throw new Error("METRICS_UNAVAILABLE");
            const text = await r.text();
            if (text.length > 1024 * 1024) throw new Error("METRICS_LIMIT");
            return { reachable: true, ...vectorCounters(text) };
          })
          .catch(() => ({
            reachable: false,
            bufferBytes: 0,
            droppedEvents: 0,
            errors: 0,
          }))
      : { reachable: false, bufferBytes: 0, droppedEvents: 0, errors: 0 },
    controllerRequest<{ logging?: LoggerStatus }>(
      "/health",
      requestId,
      undefined,
      1500,
    )
      .then((r) => r.logging ?? null)
      .catch(() => null),
    sink
      ? fetch(sink + "/metrics", { signal: AbortSignal.timeout(1500) })
          .then(async (r) => {
            if (!r.ok) throw new Error("STORAGE_METRICS_UNAVAILABLE");
            const text = await r.text();
            if (text.length > 1024 * 1024) throw new Error("METRICS_LIMIT");
            return storageMetrics(text);
          })
          .catch(() => storageMetrics(""))
      : storageMetrics(""),
  ]);
  const now = new Date().toISOString();
  const droppedEvents =
    local.droppedEvents + collector.droppedEvents + (vpn?.droppedEvents ?? 0);
  const degraded =
    local.state === "degraded" ||
    vpn?.state === "degraded" ||
    !collector.reachable ||
    collector.errors > lastErrors ||
    droppedEvents > lastDrops ||
    collector.bufferBytes >= 1073741824;
  const state = degraded
    ? "degraded"
    : !sinkReachable
      ? "buffering"
      : "healthy";
  lastErrors = collector.errors;
  lastDrops = droppedEvents;
  if (state !== "healthy") degradedSince ??= now;
  else {
    degradedSince = null;
    lastSuccessAt = now;
  }
  return {
    state,
    degradedSince,
    lastSuccessAt,
    droppedEvents,
    local,
    vpn,
    collector,
    sinkReachable,
    storage,
    observedAt: now,
    retentionDays: 14,
    storageTargetBytes: 10000000000,
    bufferLimitBytes: 1073741824,
  };
}
