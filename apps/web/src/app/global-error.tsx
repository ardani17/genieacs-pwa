"use client";

import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { captureClientError } from "@/components/error-reporter";

// Root error boundary (renders outside the layout): safe message plus
// request id; the report goes to the centralized sink.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureClientError(error, "global");
  }, [error]);

  const requestId = error.digest ?? "unknown";
  return (
    <html lang="id">
      <body>
        <main className="app-shell space-y-4" role="alert">
          <h1>Aplikasi mengalami kesalahan</h1>
          <p>Silakan muat ulang halaman.</p>
          <p>
            <small>request {requestId}</small>
          </p>
          <Button type="button" onClick={reset}>
            Muat ulang
          </Button>
        </main>
      </body>
    </html>
  );
}
