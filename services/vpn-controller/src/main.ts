import { randomUUID } from "node:crypto";
import { VpnController } from "./controller.ts";
import { LinuxVpnRuntime } from "./runtime.ts";
import { createVpnServer, tokenFromFile } from "./server.ts";
import { sendPppEvent } from "./ppp-events.ts";
import { getVpnLogger } from "./logger.ts";
import { internalServiceUrl } from "../../../lib/common/internal-url.ts";

const token = (): Buffer | null =>
  tokenFromFile(process.env.VPN_CONTROLLER_TOKEN_FILE);
const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${token()?.toString("utf8") ?? ""}`,
  "X-Request-Id": randomUUID(),
});
async function main(): Promise<void> {
  if (process.argv[2] === "--ppp-event") {
    await sendPppEvent("/vpn-private/events.sock", process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "--health") {
    const response = await fetch("http://127.0.0.1:8787/health", {
      headers: headers(),
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    if (!response.ok) process.exitCode = 1;
    return;
  }
  const runtime = new LinuxVpnRuntime(
    "/vpn-private",
    (process.env.VPN_PROTECTED_CIDRS ?? "").split(",").filter(Boolean),
  );
  const controller = new VpnController(runtime, (status) => {
    getVpnLogger(controller.installationId() ?? undefined).emit({
      level: "info",
      event:
        status.state === "connected"
          ? "vpn.profile_applied"
          : "vpn.state_changed",
      message: "VPN state observed",
      details: {
        state: status.state,
        desiredRevision: status.desiredRevision,
        appliedRevision: status.appliedRevision,
        lastErrorCode: status.lastErrorCode,
      },
    });
  });
  const server = createVpnServer(controller, token, () =>
    getVpnLogger().status(),
  );
  server.listen(8787, "0.0.0.0");
  let stopped = false;
  let inFlight: AbortController | null = null;
  let poll: ReturnType<typeof setTimeout>;
  const load = async (): Promise<void> => {
    try {
      inFlight = new AbortController();
      const response = await fetch(
        internalServiceUrl(
          process.env.GENIEACS_UI_URL ?? "http://ui:7583",
          "/api/internal/vpn/profile",
        ),
        {
          headers: headers(),
          signal: AbortSignal.any([inFlight.signal, AbortSignal.timeout(7000)]),
          cache: "no-store",
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("BACKEND_UNAVAILABLE");
      const result = (await response.json()) as { data: unknown };
      if (stopped) return;
      await controller.profile(result.data);
    } catch {
      /* Retry load in 10 seconds; never fall back to deployment env. */
    }
    if (!stopped)
      poll = setTimeout(() => {
        void load();
      }, 10000);
  };
  void load();
  const shutdown = async (): Promise<void> => {
    stopped = true;
    inFlight?.abort();
    clearTimeout(poll);
    server.close();
    await controller.stop();
    await getVpnLogger().flush(2000);
  };
  process.once("SIGTERM", () => {
    void shutdown().catch(() => {
      process.exitCode = 1;
    });
  });
  process.once("SIGINT", () => {
    void shutdown().catch(() => {
      process.exitCode = 1;
    });
  });
}
void main().catch(() => {
  process.stderr.write("VPN_CONTROLLER_START_FAILED\n");
  process.exitCode = 1;
});
