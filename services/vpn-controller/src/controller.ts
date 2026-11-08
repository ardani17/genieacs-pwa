import type {
  DesiredVpnProfile,
  VpnStatus,
} from "../../../packages/app-contracts/src/vpn.ts";
import { initialStatus, transition, type Event } from "./state.ts";
import { validateDesiredProfile } from "./profile.ts";
import type { VpnRuntime } from "./runtime.ts";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { isDnsHostname } from "../../../packages/app-contracts/src/settings.ts";
import { isRoutedAddress } from "./routes.ts";

export class VpnController {
  private state = initialStatus();
  private desired: DesiredVpnProfile | null = null;
  private work: Promise<void> = Promise.resolve();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private busy = false;
  private epoch = 0;
  constructor(
    private runtime: VpnRuntime,
    private onState: (status: VpnStatus) => void = () => undefined,
  ) {}
  status(): VpnStatus {
    return {
      ...this.state,
      routes: this.state.routes.map((r) => ({ ...r })),
      observedAt: new Date().toISOString(),
    };
  }
  installationId(): string | null {
    return this.desired?.installationId ?? null;
  }
  async profile(raw: unknown): Promise<VpnStatus> {
    const profile = validateDesiredProfile(raw);
    await this.dispatch(
      { type: "profile", revision: profile.revision, routes: profile.routes },
      profile,
    );
    return this.status();
  }
  async reconnect(): Promise<VpnStatus> {
    if (this.busy || this.state.state === "connecting")
      throw new Error("CONFLICT");
    if (!this.desired) throw new Error("UNCONFIGURED");
    this.busy = true;
    try {
      await this.dispatch({ type: "reconnect" });
      return this.status();
    } finally {
      this.busy = false;
    }
  }
  async stop(): Promise<void> {
    await this.dispatch({ type: "stop" });
  }
  async diagnose(): Promise<object> {
    return { ...(await this.runtime.diagnose()), status: this.status() };
  }
  async probe(raw: unknown): Promise<object> {
    const r = raw as { host: unknown; port: unknown };
    if (
      !r ||
      typeof r !== "object" ||
      Object.keys(r).some((k) => !["host", "port"].includes(k)) ||
      typeof r.host !== "string" ||
      !(isIPv4(r.host) || isDnsHostname(r.host)) ||
      typeof r.port !== "number" ||
      !Number.isSafeInteger(r.port) ||
      r.port < 1 ||
      r.port > 65535
    )
      throw new Error("INVALID_PROFILE");
    if (
      this.state.state !== "connected" ||
      !this.state.localIp ||
      !this.runtime.probe
    )
      throw new Error("UNCONFIGURED");
    const generation = this.epoch;
    const host = isIPv4(r.host)
      ? r.host
      : (await lookup(r.host, { family: 4 })).address;
    if (
      generation !== this.epoch ||
      !isRoutedAddress(
        host,
        this.state.routes
          .filter((route) => route.installed)
          .map((route) => route.cidr),
      )
    )
      throw new Error("INVALID_PROFILE");
    return {
      ...(await this.runtime.probe(host, r.port, this.state.localIp)),
      source: "vpn-controller",
      target: `${host}:${r.port}`,
    };
  }
  private schedule(event: Event, delayMs: number): void {
    const epoch = this.epoch;
    const timer = setTimeout(() => {
      void this.dispatch(event, undefined, epoch).catch(() => undefined);
    }, delayMs);
    timer.unref();
    this.timers.push(timer);
  }
  private dispatch(
    event: Event,
    profile?: DesiredVpnProfile,
    expectedEpoch?: number,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      if (expectedEpoch !== undefined && expectedEpoch !== this.epoch) return;
      if (profile) {
        if (profile.revision < this.state.desiredRevision)
          throw new Error("CONFLICT");
        if (profile.revision === this.state.desiredRevision) {
          if (JSON.stringify(profile) !== JSON.stringify(this.desired))
            throw new Error("CONFLICT");
          return;
        }
        this.desired = profile;
      }
      const result = transition(this.state, event);
      this.state = result.state;
      if (result.effects.some((e) => e.type === "disconnect")) ++this.epoch;
      this.onState(this.status());
      for (const effect of result.effects) {
        if (effect.type === "cancel_timers") {
          this.timers.forEach(clearTimeout);
          this.timers = [];
        } else if (effect.type === "disconnect") {
          try {
            await this.runtime.stop();
          } catch {
            this.timers.forEach(clearTimeout);
            this.timers = [];
            this.state = {
              ...this.state,
              state: "route_error",
              lastErrorCode: "ROUTE_CLEANUP_FAILED",
              nextAttemptAt: null,
            };
            this.onState(this.status());
            return;
          }
        } else if (effect.type === "connect_timeout")
          this.schedule({ type: "timeout" }, 60000);
        else if (effect.type === "stable_timer")
          this.schedule({ type: "stable" }, 60000);
        else if (effect.type === "schedule_retry")
          this.schedule({ type: "retry" }, effect.delayMs);
        else if (effect.type === "connect" && this.desired) {
          const epoch = this.epoch;
          try {
            await this.runtime.start(this.desired, (e) => {
              void this.dispatch(e, undefined, epoch).catch(() => undefined);
            });
          } catch {
            void this.dispatch(
              { type: "down", code: "PPP_START_FAILED" },
              undefined,
              epoch,
            ).catch(() => undefined);
          }
        }
      }
    };
    const pending = this.work.then(run);
    this.work = pending.catch(() => undefined);
    return pending;
  }
}
