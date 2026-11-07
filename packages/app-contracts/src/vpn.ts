// VPN status DTO: safe fields only — state with a REASON, never a bare
// "connected" claim, and no profile/secret material for vpn:1 readers.

export type VpnState =
  | "unconfigured"
  | "unavailable"
  | "connecting"
  | "connected"
  | "degraded"
  | "auth_paused";

export interface VpnStatusDTO {
  state: VpnState;
  reason: string | null;
  observedAt: string; // ISO UTC
  controllerReachable: boolean;
  lastSuccessAt: string | null;
}
