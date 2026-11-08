// Test-only effect adapter: real HTTP/controller/state machine and native
// backend, deterministic PPP outcomes; never bundled into the runtime image.
import { randomUUID } from "node:crypto";
import { VpnController } from "../src/controller.ts";
import { createVpnServer, tokenFromFile } from "../src/server.ts";
import type { VpnRuntime } from "../src/runtime.ts";
import type { DesiredVpnProfile } from "../../../packages/app-contracts/src/vpn.ts";
import type { Event } from "../src/state.ts";
class FakePppProcess implements VpnRuntime {
  private timer: ReturnType<typeof setTimeout> | null = null;
  async start(
    profile: DesiredVpnProfile,
    emit: (event: Event) => void,
  ): Promise<void> {
    this.timer = setTimeout(
      (): void =>
        emit(
          profile.server.includes("auth")
            ? { type: "auth_rejected" }
            : profile.server.includes("fail")
              ? { type: "down", code: "FIXTURE_CONNECT_FAILED" }
              : {
                  type: "up",
                  interfaceName: "ppp0",
                  localIp: "10.77.0.2",
                  peerIp: "10.77.0.1",
                },
        ),
      25,
    );
  }
  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  async diagnose(): Promise<object> {
    return {
      source: "vpn-controller",
      endpointIp: "192.0.2.1",
      observedAt: new Date().toISOString(),
      cwmp: { status: "unreachable", target: "127.0.0.1:7547" },
    };
  }
}
const token = (): Buffer | null =>
  tokenFromFile(process.env.VPN_CONTROLLER_TOKEN_FILE);
const controller = new VpnController(new FakePppProcess());
const server = createVpnServer(controller, token);
server.listen(8787, "0.0.0.0");
let stopped = false;
let timer: ReturnType<typeof setTimeout>;
async function load(): Promise<void> {
  try {
    const response = await fetch("http://ui:7583/api/internal/vpn/profile", {
      headers: {
        Authorization: `Bearer ${token()?.toString() ?? ""}`,
        "X-Request-Id": randomUUID(),
      },
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    if (response.ok) {
      const result = (await response.json()) as { data: unknown };
      if (!stopped) await controller.profile(result.data);
    }
  } catch {
    /* fixture startup races are retried */
  }
  if (!stopped) timer = setTimeout(() => void load(), 1000);
}
void load();
process.once("SIGTERM", () => {
  stopped = true;
  clearTimeout(timer);
  server.close();
  void controller.stop();
});
