import { test, expect } from "vitest";
import type { ConnectionState } from "./connection-state";
import {
  reduceConnection,
  initialConnectionState,
  PROBE_FAILURE_THRESHOLD,
} from "./connection-state";

test("VPN failure does not mark web offline", () => {
  const s: ConnectionState = {
    app: "reachable",
    failedProbes: 0,
    vpn: "connected",
    lastSuccessAt: null,
  };
  expect(
    reduceConnection(s, { type: "vpn", state: "auth_failed" }),
  ).toMatchObject({ app: "reachable", vpn: "auth_failed" });
});

test("three probe failures => unavailable, one success resets", () => {
  let s: ConnectionState = initialConnectionState();
  expect(s.app).toBe("checking");
  for (let i = 1; i < PROBE_FAILURE_THRESHOLD; ++i) {
    s = reduceConnection(s, { type: "probe_fail" });
    expect(s.app).toBe("checking");
  }
  s = reduceConnection(s, { type: "probe_fail" });
  expect(s.app).toBe("unavailable");
  s = reduceConnection(s, { type: "probe_ok", at: "2026-11-01T00:00:00.000Z" });
  expect(s.app).toBe("reachable");
  expect(s.failedProbes).toBe(0);
  expect(s.lastSuccessAt).toBe("2026-11-01T00:00:00.000Z");
});

test("navigator hints never set reachability directly", () => {
  let s: ConnectionState = {
    ...initialConnectionState(),
    app: "unavailable",
    failedProbes: 5,
  };
  s = reduceConnection(s, { type: "online_hint" });
  expect(s.app).toBe("checking");
  s = reduceConnection(s, { type: "offline_hint" });
  expect(s.app).toBe("checking");
  // Only a probe result decides.
  s = reduceConnection(s, { type: "probe_ok" });
  expect(s.app).toBe("reachable");
});

test("failed probes accumulate across checking cycles", () => {
  let s = initialConnectionState();
  s = reduceConnection(s, { type: "probe_fail" });
  s = reduceConnection(s, { type: "probe_fail" });
  expect(s.app).toBe("checking");
  s = reduceConnection(s, { type: "probe_fail" });
  expect(s.app).toBe("unavailable");
  expect(s.failedProbes).toBe(PROBE_FAILURE_THRESHOLD);
});
