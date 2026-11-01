// Engine healthcheck: probes the service's own HTTP endpoint on
// loopback. Exit 0 only when the service answers; the reason is written
// to stdout (no environment contents).
const port = process.argv[2] ?? process.env.PORT ?? "3000";
const path = process.argv[3] ?? "/status";

try {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) {
    console.log(`unhealthy: HTTP ${response.status}`);
    process.exit(1);
  }
  console.log("healthy");
  process.exit(0);
} catch (err) {
  console.log(`unhealthy: ${err instanceof Error ? err.name : "error"}`);
  process.exit(1);
}
