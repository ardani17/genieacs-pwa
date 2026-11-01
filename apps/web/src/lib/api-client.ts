// Browser-side typed API client returning ApiResult envelopes (never
// throws for known HTTP outcomes).
import type { ApiResult } from "@contracts/api.ts";

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.method && init.method !== "GET"
          ? { "X-App-Request": "1" }
          : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
      cache: "no-store",
    });
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
