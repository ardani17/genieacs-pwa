// Bulk runner unit tests (spec gap M05-D/M05-E): bounded to 100
// targets, at most 4 concurrent submissions, per-target results,
// cancellation skips only un-started targets, and a lost connection
// reports unknown without retry.
import { describe, expect, it } from "vitest";
import { BULK_CONCURRENCY, BULK_MAX_TARGETS, runBulk } from "./bulk";

function makeTargets(n: number): { deviceId: string }[] {
  return Array.from({ length: n }, (_, i) => ({ deviceId: `D-${i}` }));
}

describe("runBulk", () => {
  it("caps at 100 targets", async () => {
    let submitted = 0;
    const handle = await runBulk(makeTargets(120), {
      async submit(t) {
        submitted++;
        return { deviceId: t.deviceId, state: "succeeded" };
      },
    });
    expect(submitted).toBe(BULK_MAX_TARGETS);
    expect(handle.outcomes).toHaveLength(BULK_MAX_TARGETS);
  });

  it("runs at most 4 submissions concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk(makeTargets(20), {
      async submit(t) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return { deviceId: t.deviceId, state: "succeeded" };
      },
    });
    expect(peak).toBeLessThanOrEqual(BULK_CONCURRENCY);
    expect(peak).toBe(BULK_CONCURRENCY);
  });

  it("returns per-target results in target order", async () => {
    // Later targets resolve first — outcomes stay input-ordered.
    const handle = await runBulk(makeTargets(6), {
      async submit(t) {
        const delay = Number(t.deviceId.split("-")[1]);
        await new Promise((r) => setTimeout(r, 20 - delay));
        return { deviceId: t.deviceId, state: "succeeded" };
      },
    });
    expect(handle.outcomes.map((o) => o.deviceId)).toEqual(
      makeTargets(6).map((t) => t.deviceId),
    );
  });

  it("cancellation skips only un-started targets", async () => {
    const controller = new AbortController();
    let started = 0;
    const handle = await runBulk(
      makeTargets(12),
      {
        async submit(t) {
          started++;
          if (started === 2) controller.abort();
          await new Promise((r) => setTimeout(r, 5));
          return { deviceId: t.deviceId, state: "succeeded" };
        },
      },
      controller.signal,
    );
    expect(handle.cancelled).toBe(true);
    const skipped = handle.outcomes.filter((o) => o.state === "skipped");
    const done = handle.outcomes.filter((o) => o.state === "succeeded");
    // In-flight submissions (at least the 4 workers' current targets)
    // complete; everything queued after the abort is skipped.
    expect(done.length).toBeGreaterThanOrEqual(2);
    expect(skipped.length).toBe(12 - done.length);
    expect(handle.outcomes).toHaveLength(12);
  });

  it("a lost connection reports unknown and never retries", async () => {
    const attempts = new Map<string, number>();
    const handle = await runBulk(makeTargets(3), {
      async submit(t) {
        attempts.set(t.deviceId, (attempts.get(t.deviceId) ?? 0) + 1);
        if (t.deviceId === "D-1") throw new Error("network dropped");
        return { deviceId: t.deviceId, state: "succeeded" };
      },
    });
    const unknown = handle.outcomes.find((o) => o.deviceId === "D-1");
    expect(unknown?.state).toBe("unknown");
    expect(attempts.get("D-1")).toBe(1);
  });
});
