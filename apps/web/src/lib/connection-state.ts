// Connection state machine: the app's own reachability is decided ONLY
// by probe results (three consecutive failures => unreachable, one
// success => reachable; navigator.online is a HINT that triggers an
// immediate probe, never a final state). VPN status is tracked
// SEPARATELY — a VPN failure never marks the web app offline.

export type AppReachable = "checking" | "reachable" | "unavailable";

export interface ConnectionState {
  app: AppReachable;
  failedProbes: number;
  vpn:
    | "unconfigured"
    | "unavailable"
    | "connecting"
    | "connected"
    | "degraded"
    | "auth_failed";
  lastSuccessAt: string | null;
}

export type ConnectionEvent =
  | { type: "probe_start" }
  | { type: "probe_ok"; at?: string }
  | { type: "probe_fail" }
  | { type: "online_hint" }
  | { type: "offline_hint" }
  | { type: "vpn"; state: ConnectionState["vpn"] };

export const PROBE_FAILURE_THRESHOLD = 3;

export function initialConnectionState(): ConnectionState {
  return {
    app: "checking",
    failedProbes: 0,
    vpn: "unconfigured",
    lastSuccessAt: null,
  };
}

export function reduceConnection(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  switch (event.type) {
    case "probe_start":
      // First failure => checking; the third consecutive failure =>
      // unavailable.
      return {
        ...state,
        app:
          state.failedProbes + 1 >= PROBE_FAILURE_THRESHOLD
            ? "unavailable"
            : "checking",
      };
    case "probe_ok":
      return {
        ...state,
        app: "reachable",
        failedProbes: 0,
        lastSuccessAt: event.at ?? new Date().toISOString(),
      };
    case "probe_fail":
      return {
        ...state,
        failedProbes: state.failedProbes + 1,
        app:
          state.failedProbes + 1 >= PROBE_FAILURE_THRESHOLD
            ? "unavailable"
            : "checking",
      };
    case "online_hint":
      // A navigator.online hint only triggers a fresh checking cycle —
      // never directly "reachable".
      return { ...state, app: "checking" };
    case "offline_hint":
      // Offline hint also never sets the final state: probe decides.
      return { ...state, app: "checking" };
    case "vpn":
      // VPN state is independent of web reachability.
      return { ...state, vpn: event.state };
  }
}
