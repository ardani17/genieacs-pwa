// Bounded, closed-schema log query builder for the centralized log
// store (VictoriaLogs LogsQL). Raw query expressions are NOT accepted;
// only the known filter fields, a bounded time window and paging.

export const LOG_WINDOW_DEFAULT_MS = 15 * 60 * 1000;
export const LOG_WINDOW_MAX_MS = 24 * 60 * 60 * 1000;
export const LOG_LIMIT_DEFAULT = 100;
export const LOG_LIMIT_MAX = 500;
export const LOG_OFFSET_MAX = 5000;

export class LogQueryError extends Error {
  code = "VALIDATION";

  constructor(message: string) {
    super(`VALIDATION ${message}`);
    this.name = "Error";
  }
}

export interface LogFilters {
  start?: string;
  end?: string;
  service?: string;
  level?: "debug" | "info" | "warn" | "error";
  requestId?: string;
  operationId?: string;
  deviceId?: string;
  limit?: number;
  offset?: number;
  query?: never; // raw queries are rejected by the type AND runtime
}

const FIELD_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

function escapeLogsqlString(value: string): string {
  // Escape backslashes and double quotes, strip control characters.
  const cleaned = value
    .replace(/[\\""]/g, (c) => `\\${c}`)
    .replace(/[\r\n\t]/g, " ");
  return cleaned;
}

export function buildLogQuery(filters: LogFilters): {
  query: string;
  start?: string;
  end?: string;
  limit: number;
  offset: number;
} {
  if (filters.query !== undefined)
    throw new LogQueryError("raw query expressions are not allowed");

  const now = Date.now();
  let startMs: number;
  let endMs: number;

  if (filters.start) {
    const t = Date.parse(filters.start);
    if (!Number.isFinite(t)) throw new LogQueryError("invalid start");
    startMs = t;
  } else {
    startMs = now - LOG_WINDOW_DEFAULT_MS;
  }

  if (filters.end) {
    const t = Date.parse(filters.end);
    if (!Number.isFinite(t)) throw new LogQueryError("invalid end");
    endMs = t;
  } else {
    endMs = now;
  }

  if (endMs <= startMs) throw new LogQueryError("end must be after start");
  if (endMs - startMs > LOG_WINDOW_MAX_MS)
    throw new LogQueryError("time window exceeds 24h");

  const limit = filters.limit ?? LOG_LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LOG_LIMIT_MAX)
    throw new LogQueryError(`limit must be 1..${LOG_LIMIT_MAX}`);

  const offset = filters.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > LOG_OFFSET_MAX)
    throw new LogQueryError(`offset must be 0..${LOG_OFFSET_MAX}`);

  const terms: string[] = [];
  for (const field of [
    "service",
    "requestId",
    "operationId",
    "deviceId",
  ] as const) {
    const value = filters[field];
    if (value === undefined) continue;
    if (!FIELD_PATTERN.test(value) && field === "service")
      throw new LogQueryError("invalid service name");
    terms.push(`${field}:"${escapeLogsqlString(value)}"`);
  }
  if (filters.level) {
    if (!["debug", "info", "warn", "error"].includes(filters.level))
      throw new LogQueryError("invalid level");
    terms.push(`level:"${filters.level}"`);
  }

  const query = terms.length ? terms.join(" ") : "*";
  return {
    query,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    limit,
    offset,
  };
}
