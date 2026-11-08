import type { VpnStatus } from "../../../packages/app-contracts/src/vpn.ts";

export type Event =
  | { type: "profile"; revision: number; routes: string[] }
  | { type: "up"; interfaceName: string; localIp: string; peerIp: string }
  | { type: "down"; code: string }
  | { type: "auth_rejected" }
  | { type: "route_error" }
  | { type: "host_unsupported" }
  | { type: "timeout" | "retry" | "stable" | "reconnect" | "stop" };
export type Effect =
  | {
      type:
        | "connect"
        | "disconnect"
        | "cancel_timers"
        | "stable_timer"
        | "connect_timeout";
    }
  | { type: "schedule_retry"; delayMs: number };

export function initialStatus(now = Date.now()): VpnStatus {
  return {
    state: "unconfigured",
    desiredRevision: 0,
    appliedRevision: null,
    interfaceName: null,
    localIp: null,
    peerIp: null,
    attempt: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    observedAt: new Date(now).toISOString(),
    routes: [],
  };
}

export function transition(
  previous: VpnStatus,
  event: Event,
  clock: () => number = Date.now,
  rng: () => number = Math.random,
): { state: VpnStatus; effects: Effect[] } {
  const now = clock();
  let state = { ...previous, observedAt: new Date(now).toISOString() };
  const cleared = (): VpnStatus => ({
    ...state,
    interfaceName: null,
    localIp: null,
    peerIp: null,
    nextAttemptAt: null,
    routes: state.routes.map((r) => ({ ...r, installed: false })),
  });
  const connect = (): { state: VpnStatus; effects: Effect[] } => ({
    state: {
      ...cleared(),
      state: "connecting",
      attempt: state.attempt + 1,
      lastErrorCode: null,
    },
    effects: [
      { type: "cancel_timers" },
      { type: "disconnect" },
      { type: "connect_timeout" },
      { type: "connect" },
    ],
  });
  if (event.type === "profile") {
    if (event.revision <= state.desiredRevision) return { state, effects: [] };
    state = {
      ...state,
      desiredRevision: event.revision,
      attempt: 0,
      routes: event.routes.map((cidr) => ({ cidr, installed: false })),
    };
    return connect();
  }
  if (event.type === "stop")
    return {
      state: { ...cleared(), state: "stopped" },
      effects: [{ type: "cancel_timers" }, { type: "disconnect" }],
    };
  if (event.type === "reconnect") {
    if (!state.desiredRevision || state.state === "connecting")
      return { state, effects: [] };
    state.attempt = 0;
    return connect();
  }
  if (event.type === "retry")
    return state.state === "retry_wait" ? connect() : { state, effects: [] };
  if (event.type === "up") {
    if (state.state !== "connecting") return { state, effects: [] };
    return {
      state: {
        ...state,
        interfaceName: event.interfaceName,
        localIp: event.localIp,
        peerIp: event.peerIp,
        state: "connected",
        appliedRevision: state.desiredRevision,
        nextAttemptAt: null,
        lastErrorCode: null,
        routes: state.routes.map((r) => ({ ...r, installed: true })),
      },
      effects: [{ type: "cancel_timers" }, { type: "stable_timer" }],
    };
  }
  if (event.type === "stable")
    return {
      state: state.state === "connected" ? { ...state, attempt: 0 } : state,
      effects: [],
    };
  if (
    event.type === "host_unsupported" ||
    event.type === "route_error" ||
    event.type === "auth_rejected"
  ) {
    if (state.state !== "connecting" && state.state !== "connected")
      return { state, effects: [] };
    const failedState =
      event.type === "auth_rejected" ? "auth_failed" : event.type;
    return {
      state: {
        ...cleared(),
        state: failedState,
        lastErrorCode: failedState.toUpperCase(),
      },
      effects: [{ type: "cancel_timers" }, { type: "disconnect" }],
    };
  }
  if (event.type === "down" || event.type === "timeout") {
    if (state.state !== "connecting" && state.state !== "connected")
      return { state, effects: [] };
    const base = [10000, 20000, 40000, 60000][
      Math.min(3, Math.max(0, state.attempt - 1))
    ];
    const delayMs = Math.round(
      base * (1 + 0.2 * Math.min(1, Math.max(0, rng()))),
    );
    return {
      state: {
        ...cleared(),
        state: "retry_wait",
        lastErrorCode: event.type === "down" ? event.code : "CONNECT_TIMEOUT",
        nextAttemptAt: new Date(now + delayMs).toISOString(),
      },
      effects: [
        { type: "cancel_timers" },
        { type: "disconnect" },
        { type: "schedule_retry", delayMs },
      ],
    };
  }
  return { state, effects: [] };
}
