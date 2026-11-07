"use client";

// Client error capture: forwards ONLY the whitelisted fields to
// /api/app/client-errors; the server associates actor + requestId. The
// sanitized stack never carries payloads.
export function captureClientError(error: unknown, location: string): void {
  const event =
    error instanceof Error
      ? {
          event: error.name || "Error",
          message: String(error.message).slice(0, 500),
          stack: error.stack ? String(error.stack).slice(0, 4000) : undefined,
          location: location.slice(0, 500),
        }
      : {
          event: "UnknownError",
          message: String(error).slice(0, 500),
          location: location.slice(0, 500),
        };

  void fetch("/api/app/client-errors", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: window.location.origin,
      "X-App-Request": "1",
    },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {
    // Never let reporting break the app further.
  });
}
