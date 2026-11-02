// LogEvent contract (docs/design/contracts.md): the single wire shape for
// application logs across web/engine/vpn services, consumed by the
// Vector→VictoriaLogs pipeline (M01-F).

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogError {
  code: string;
  name: string;
  stack?: string;
}

export interface LogEvent {
  schemaVersion: 1;
  timestamp: string; // ISO UTC
  level: LogLevel;
  service: string;
  appVersion: string;
  installationId: string;
  environment: "test" | "production";
  event: string;
  message: string;
  requestId?: string;
  // Server-minted audit identity correlation: the inbound (trusted
  // parent) id that preceded this request's requestId, when one was
  // presented (contracts.md "identitas audit server, inbound parent").
  parentRequestId?: string;
  operationId?: string;
  actorId?: string;
  deviceId?: string;
  taskId?: string;
  durationMs?: number;
  outcome?: "success" | "failure" | "partial" | "unknown";
  error?: LogError;
  details?: Record<string, unknown>;
}

export type LoggingState = "healthy" | "buffering" | "degraded";

export interface LoggerStatus {
  state: LoggingState;
  droppedEvents: number;
  lastSuccessAt: string | null;
}

export interface LogQuery {
  start?: string;
  end?: string;
  service?: string;
  level?: LogLevel;
  requestId?: string;
  operationId?: string;
  deviceId?: string;
  limit?: number;
  offset?: number;
}
