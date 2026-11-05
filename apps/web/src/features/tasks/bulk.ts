"use client";

// Bulk operation runner (contracts.md): max 100 targets, at most 4
// operations in flight, results per target, and cancellation only
// stops targets whose submission has NOT started. No automatic retry.

export const BULK_MAX_TARGETS = 100;
export const BULK_CONCURRENCY = 4;

export interface BulkTarget {
  deviceId: string;
}

export interface BulkOutcome {
  deviceId: string;
  state: "succeeded" | "failed" | "unknown" | "skipped";
  operationId?: string;
  message?: string;
}

export interface BulkHandle {
  outcomes: BulkOutcome[];
  cancelled: boolean;
}

interface BulkDeps {
  submit(target: BulkTarget): Promise<BulkOutcome>;
}

// Run `targets` through `submit` with bounded concurrency. `cancelled`
// flips when the caller aborts; queued (not-yet-started) targets are
// reported as skipped — in-flight submissions always complete so their
// operation ids stay knowable.
export async function runBulk(
  targets: BulkTarget[],
  deps: BulkDeps,
  signal?: AbortSignal,
): Promise<BulkHandle> {
  const bounded = targets.slice(0, BULK_MAX_TARGETS);
  const outcomes: BulkOutcome[] = [];
  let cursor = 0;
  let cancelled = false;
  const onAbort = (): void => {
    cancelled = true;
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const worker = async (): Promise<void> => {
    while (!cancelled) {
      const index = cursor++;
      if (index >= bounded.length) return;
      const target = bounded[index];
      try {
        outcomes.push(await deps.submit(target));
      } catch {
        // Network loss mid-submit: the operation MAY have reached the
        // engine — report unknown, never resubmit.
        outcomes.push({
          deviceId: target.deviceId,
          state: "unknown",
          message: "Koneksi terputus; hasil belum terkonfirmasi.",
        });
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(BULK_CONCURRENCY, bounded.length) },
    () => worker(),
  );
  await Promise.all(workers);
  signal?.removeEventListener("abort", onAbort);

  if (cancelled) {
    const seen = new Set(outcomes.map((o) => o.deviceId));
    for (const target of bounded) {
      if (!seen.has(target.deviceId))
        outcomes.push({
          deviceId: target.deviceId,
          state: "skipped",
          message: "Dibatalkan sebelum dikirim.",
        });
    }
  }
  // Stable per-target ordering regardless of completion order.
  outcomes.sort(
    (a, b) =>
      bounded.findIndex((t) => t.deviceId === a.deviceId) -
      bounded.findIndex((t) => t.deviceId === b.deviceId),
  );
  return { outcomes, cancelled };
}
