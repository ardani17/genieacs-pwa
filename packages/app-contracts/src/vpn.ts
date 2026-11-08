export type VpnState =
  | "unconfigured"
  | "connecting"
  | "connected"
  | "retry_wait"
  | "auth_failed"
  | "route_error"
  | "host_unsupported"
  | "stopped";

export interface VpnStatus {
  state: VpnState;
  desiredRevision: number;
  appliedRevision: number | null;
  interfaceName: string | null;
  localIp: string | null;
  peerIp: string | null;
  attempt: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  observedAt: string;
  routes: { cidr: string; installed: boolean }[];
}

// Internal only: never forwarded to the browser or written to a log.
export interface DesiredVpnProfile {
  revision: number;
  installationId: string;
  server: string;
  username: string;
  password: string;
  routes: string[];
  mtu: number;
}

// Compatibility for existing connection widgets during the richer status rollout.
export interface VpnStatusDTO {
  state: VpnState | "unavailable" | "degraded" | "auth_paused";
  reason: string | null;
  observedAt: string;
  controllerReachable: boolean;
  lastSuccessAt: string | null;
}
