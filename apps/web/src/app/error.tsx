"use client";

// Route-level error boundary: a safe message plus the request/digest id
// for diagnosis. The sanitized reporter wiring lands with M03-C.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
