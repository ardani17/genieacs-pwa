// Shared application API contracts (docs/design/contracts.md). The BFF
// (M02) emits exactly these shapes; the browser consumes them through
// apiRequest, which never throws for known HTTP errors — callers branch
// on ok.

export type Expression = null | boolean | number | string | Expression[];

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "BACKEND_UNAVAILABLE"
  | "TIMEOUT"
  | "VPN_UNAVAILABLE"
  | "DEVICE_UNREACHABLE"
  | "DEVICE_FAULT"
  | "PARTIAL_RESULT"
  | "RESULT_UNKNOWN"
  | "LOGGING_DEGRADED"
  | "UNSUPPORTED_PROFILE"
  | "STORAGE_ERROR"
  | "INTERNAL";

export interface ApiError {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  retryable: boolean;
}

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: ApiError; requestId: string };

export interface SessionDTO {
  username: string;
  roles: string[];
  permissionSets: Record<
    string,
    {
      access: number;
      filter?: Expression;
      validate?: Expression;
    }
  >[];
  expiresAt: string; // ISO UTC
  configRevision: string;
  uiConfig: Record<string, unknown>;
  appVersion: string;
  upstreamVersion: string;
}

export interface Page<T> {
  items: T[];
  total: number | null;
  page: number;
  pageSize: 25 | 50 | 100;
  hasNext: boolean;
  observedAt: string;
  source: "live";
}

export type ResourceName =
  | "devices"
  | "presets"
  | "provisions"
  | "virtualParameters"
  | "files"
  | "config"
  | "permissions"
  | "users"
  | "faults"
  | "tasks"
  | "vpn"
  | "logs";

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return {
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Network error",
        retryable: true,
      },
      requestId: "unknown",
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `Unexpected response (${response.status})`,
        retryable: false,
      },
      requestId: response.headers.get("x-request-id") ?? "unknown",
    };
  }

  const result = body as ApiResult<T>;
  if (result && typeof result === "object" && "ok" in result) return result;

  return {
    ok: false,
    error: {
      code: "INTERNAL",
      message: "Malformed envelope",
      retryable: false,
    },
    requestId: response.headers.get("x-request-id") ?? "unknown",
  };
}
