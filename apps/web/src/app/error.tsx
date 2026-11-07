"use client";

import { useEffect } from "react";
import { captureClientError } from "@/components/error-reporter";

// Route-level error boundary: safe message plus the request/digest id;
// the sanitized report reaches the centralized log via the BFF sink.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureClientError(error, `route:${location.pathname}`);
  }, [error]);

  const requestId = error.digest ?? "unknown";
  return (
    <section role="alert" aria-labelledby="error-title">
      <h1 id="error-title">Terjadi kesalahan</h1>
      <p>Permintaan tidak dapat diselesaikan. Silakan coba lagi.</p>
      <p>
        <small>request {requestId}</small>
      </p>
      <button type="button" onClick={reset}>
        Coba lagi
      </button>
    </section>
  );
}
