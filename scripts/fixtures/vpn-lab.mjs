// Explicit live lab only: read credentials from a local mounted file, never
// print them, never publish ports, and emit only the controller's safe status.
import http from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
const token = readFileSync("/run/controller.token", "utf8").trim();
const headers = () => ({
  Authorization: `Bearer ${token}`,
  "X-Request-Id": randomUUID(),
});
if (process.argv.includes("--probe")) {
  const revisionIndex = process.argv.indexOf("--revision");
  const expectedRevision =
    revisionIndex < 0 ? null : Number(process.argv[revisionIndex + 1]);
  let reconnect = null;
  if (process.argv.includes("--reconnect")) {
    const first = await fetch("http://vpn-lab:8787/reconnect", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10000),
    });
    const second = await fetch("http://vpn-lab:8787/reconnect", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10000),
    });
    reconnect = { first: first.status, duplicate: second.status };
  }
  let status = null;
  for (let attempt = 0; attempt < 85; ++attempt) {
    try {
      const response = await fetch("http://vpn-lab:8787/status", {
        headers: headers(),
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        status = (await response.json()).data;
        if (
          (expectedRevision == null ||
            status.desiredRevision === expectedRevision) &&
          [
            "connected",
            "auth_failed",
            "host_unsupported",
            "route_error",
            "retry_wait",
          ].includes(status.state)
        )
          break;
      }
    } catch {
      /* boot race */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  mkdirSync("artifacts/vpn-lab", { recursive: true });
  writeFileSync(
    "artifacts/vpn-lab/status.json",
    JSON.stringify(status, null, 2) + "\n",
  );
  console.log(JSON.stringify(status));
  if (reconnect) {
    writeFileSync(
      "artifacts/vpn-lab/reconnect.json",
      JSON.stringify({ ...reconnect, state: status?.state }, null, 2) + "\n",
    );
    console.log(JSON.stringify(reconnect));
    if (reconnect.first !== 200 || reconnect.duplicate !== 409)
      process.exitCode = 1;
  }
  if (
    status?.state !== "connected" ||
    (expectedRevision != null && status.desiredRevision !== expectedRevision)
  )
    process.exitCode = 1;
} else {
  const profile = JSON.parse(readFileSync("/run/lab-profile.json", "utf8"));
  http
    .createServer((req, res) => {
      const candidate = Buffer.from(req.headers.authorization ?? ""),
        expected = Buffer.from(`Bearer ${token}`);
      if (
        req.method !== "GET" ||
        req.url !== "/api/internal/vpn/profile" ||
        candidate.length !== expected.length ||
        !timingSafeEqual(candidate, expected)
      ) {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok: true, data: profile }));
    })
    .listen(7583, "0.0.0.0");
}
