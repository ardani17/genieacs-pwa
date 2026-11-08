import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs, constants } from "node:fs";
import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { createServer, createConnection, type Server } from "node:net";
import { join } from "node:path";
import type { DesiredVpnProfile } from "../../../packages/app-contracts/src/vpn.ts";
import type { Event } from "./state.ts";
import { atomicPrivateFile, writeProfile } from "./profile.ts";
import {
  authenticationRejected,
  pppExitCode,
  parsePppEvent,
  type PppEvent,
} from "./ppp-events.ts";
import {
  validateRoutes,
  removeOwnedRoutes,
  routeMetric,
  routeArgs,
  type OwnedRoute,
  type RunIp,
} from "./routes.ts";

export interface VpnRuntime {
  start(
    profile: DesiredVpnProfile,
    emit: (event: Event) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  diagnose(): Promise<object>;
  probe?(
    host: string,
    port: number,
    localIp: string,
  ): Promise<{ status: string; durationMs: number; observedAt: string }>;
}
export function runIp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/sbin/ip", args, {
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 1024 * 1024) child.kill("SIGKILL");
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("IP_COMMAND_FAILED"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else reject(new Error("IP_COMMAND_FAILED"));
    });
  });
}
export async function terminateProcessGroup(
  child: ChildProcess,
): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;
  const exists = (): boolean => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw err;
    }
  };
  if (!exists()) return;
  process.kill(-pid, "SIGTERM");
  const deadline = Date.now() + 2000;
  while (exists() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (exists()) process.kill(-pid, "SIGKILL");
  const killedDeadline = Date.now() + 2000;
  while (exists() && Date.now() < killedDeadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (exists()) throw new Error("PPP_STOP_FAILED");
}
export async function tcpProbe(
  host: string,
  port: number,
  localAddress?: string,
): Promise<{ status: string; durationMs: number; observedAt: string }> {
  const started = Date.now();
  const status = await new Promise<string>((resolve) => {
    const socket = createConnection({ host, port, localAddress });
    const done = (result: string): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(3000, () => done("timeout"));
    socket.once("connect", () => done("ok"));
    socket.once("error", () => done("unreachable"));
  });
  return {
    status,
    durationMs: Date.now() - started,
    observedAt: new Date().toISOString(),
  };
}

export class LinuxVpnRuntime implements VpnRuntime {
  private child: ChildProcess | null = null;
  private events: Server | null = null;
  private generation: string | null = null;
  private connectedInterface: string | null = null;
  private downWaiter: { generation: string; resolve: () => void } | null = null;
  private owned: OwnedRoute[] = [];
  private ownsJournal = false;
  private endpoint: string | null = null;
  private profile: DesiredVpnProfile | null = null;
  private emit: (event: Event) => void = () => undefined;
  private routeWork: Promise<void> = Promise.resolve();
  constructor(
    private dir = "/vpn-private",
    private protectedCidrs: string[] = [],
    private deps: {
      runIp?: RunIp;
      assertHostSupported?: () => Promise<void>;
    } = {},
  ) {}
  private runIp(args: string[]): Promise<string> {
    return (this.deps.runIp ?? runIp)(args);
  }

  async start(
    profile: DesiredVpnProfile,
    emit: (event: Event) => void,
  ): Promise<void> {
    this.emit = emit;
    this.profile = profile;
    try {
      if (this.deps.assertHostSupported) await this.deps.assertHostSupported();
      else {
        const device = await fs.stat("/dev/ppp");
        if (
          !device.isCharacterDevice() ||
          Math.floor(device.rdev / 256) % 4096 !== 108
        )
          throw new Error("PPP_DEVICE");
        const handle = await fs.open("/dev/ppp", "r+");
        await handle.close();
      }
    } catch {
      emit({ type: "host_unsupported" });
      return;
    }
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.dir, 0o700);
    // Recover this installation's route journal before creating new routes.
    try {
      const journal = JSON.parse(
        await fs.readFile(join(this.dir, "routes.json"), "utf8"),
      );
      if (
        journal.installationId !== profile.installationId ||
        !Array.isArray(journal.routes) ||
        journal.routes.length > 33 ||
        journal.routes.some(
          (r: OwnedRoute) =>
            r.metric !== routeMetric(journal.installationId, journal.revision),
        )
      )
        throw new Error("INVALID_ROUTE_JOURNAL");
      for (const route of journal.routes) routeArgs("del", route);
      this.owned = journal.routes;
      this.ownsJournal = true;
      await removeOwnedRoutes((args) => this.runIp(args), this.owned);
      await fs.unlink(join(this.dir, "routes.json"));
      this.owned = [];
      this.ownsJournal = false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        emit({ type: "route_error" });
        return;
      }
    }
    const generation = randomUUID();
    this.generation = generation;
    try {
      const endpoint = await Promise.race([
        lookup(profile.server, { family: 4 }),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new Error("DNS_TIMEOUT")), 5000);
          t.unref();
        }),
      ]);
      this.endpoint = endpoint.address;
      const addresses = JSON.parse(
        await this.runIp(["-j", "-4", "address", "show"]),
      );
      const protectedCidrs = [...this.protectedCidrs];
      for (const intf of addresses)
        for (const addr of intf.addr_info ?? [])
          if (intf.ifname !== "lo" && !/^ppp\d+$/.test(intf.ifname))
            protectedCidrs.push(`${addr.local}/${addr.prefixlen}`);
      const routes = validateRoutes(profile.routes, protectedCidrs);
      const egress = JSON.parse(
        await this.runIp(["-j", "-4", "route", "get", endpoint.address]),
      )[0];
      if (!egress?.dev || /^ppp/.test(egress.dev))
        throw new Error("INVALID_EGRESS");
      const metric = routeMetric(profile.installationId, profile.revision);
      const existing = JSON.parse(
        await this.runIp([
          "-j",
          "-4",
          "route",
          "show",
          "exact",
          `${endpoint.address}/32`,
        ]),
      );
      if (!existing.length)
        await this.addOwned({
          cidr: `${endpoint.address}/32`,
          dev: egress.dev,
          ...(egress.gateway ? { gateway: egress.gateway } : {}),
          metric,
        });
      await writeProfile(this.dir, profile, endpoint.address, generation);
      const socketPath = join(this.dir, "events.sock");
      await fs.unlink(socketPath).catch(() => undefined);
      this.events = createServer((socket) => {
        let data = "";
        socket.setTimeout(2000, () => socket.destroy());
        socket.on("data", (chunk) => {
          data += String(chunk);
          if (data.length > 2048) socket.destroy();
        });
        socket.once("end", () => {
          try {
            const event = parsePppEvent(JSON.parse(data));
            if (
              event.type === "down" &&
              event.generation === this.downWaiter?.generation
            )
              this.downWaiter.resolve();
            if (event.generation !== this.generation) return;
            this.routeWork = this.routeWork
              .then(() => this.onPpp(event, routes, metric))
              .catch(() => emit({ type: "route_error" }));
          } catch {
            /* Ignore malformed or stale local hook events. */
          }
        });
        socket.on("error", () => undefined);
      });
      await new Promise<void>((resolve, reject) => {
        this.events!.once("error", reject);
        this.events!.listen(socketPath, resolve);
      });
      await fs.chmod(socketPath, 0o600);
      const child = spawn(
        "/usr/sbin/xl2tpd",
        [
          "-D",
          "-c",
          join(this.dir, "xl2tpd.conf"),
          "-p",
          join(this.dir, "xl2tpd.pid"),
          "-C",
          join(this.dir, "control"),
        ],
        { detached: true, stdio: ["ignore", "ignore", "pipe"], shell: false },
      );
      this.child = child;
      let tail = "";
      child.stderr.on("data", (chunk) => {
        tail = (tail + String(chunk)).slice(-4096);
        if (generation === this.generation && authenticationRejected(tail))
          emit({ type: "auth_rejected" });
        else if (generation === this.generation) {
          const code = pppExitCode(tail);
          if (
            code === 3 ||
            code === 4 ||
            /(?:lacks kernel support for PPP|couldn't open.*\/dev\/ppp|protocol not supported|operation not permitted)/i.test(
              tail,
            )
          )
            emit({ type: "host_unsupported" });
          else if (
            code === 2 ||
            /parse_config:|Unable to load config file/.test(tail)
          )
            emit({ type: "route_error" });
          else if (code !== null) emit({ type: "down", code: "PPP_EXIT" });
        }
        // Never relay raw xl2tpd/pppd output: it may contain credentials.
      });
      child.once("error", () => {
        if (generation === this.generation)
          emit({ type: "down", code: "PPP_START_FAILED" });
      });
      child.once("exit", (code) => {
        if (generation === this.generation)
          emit(
            code === 19
              ? { type: "auth_rejected" }
              : { type: "down", code: "PPP_EXIT" },
          );
      });
    } catch (err) {
      const message = (err as Error).message;
      emit(
        /ROUTE|EGRESS|IP_COMMAND/.test(message)
          ? { type: "route_error" }
          : { type: "down", code: "ENDPOINT_UNAVAILABLE" },
      );
    }
  }
  private async addOwned(route: OwnedRoute): Promise<void> {
    // Record intent before the syscall, so a crash cannot orphan an owned route.
    this.owned.push(route);
    this.ownsJournal = true;
    await atomicPrivateFile(
      join(this.dir, "routes.json"),
      JSON.stringify({
        installationId: this.profile!.installationId,
        revision: this.profile!.revision,
        routes: this.owned,
      }),
    );
    await this.runIp(routeArgs("add", route));
  }
  private async onPpp(
    event: PppEvent,
    routes: string[],
    metric: number,
  ): Promise<void> {
    if (event.generation !== this.generation) return;
    if (event.type === "down") {
      this.connectedInterface = null;
      this.emit({ type: "down", code: "PPP_DOWN" });
      return;
    }
    this.connectedInterface = event.interfaceName;
    if (this.owned.some((r) => r.dev === event.interfaceName)) return;
    for (const cidr of routes)
      await this.addOwned({ cidr, dev: event.interfaceName, metric });
    if (event.generation === this.generation)
      this.emit({
        type: "up",
        interfaceName: event.interfaceName,
        localIp: event.localIp,
        peerIp: event.peerIp,
      });
  }
  async stop(): Promise<void> {
    const generation = this.generation;
    this.generation = null;
    const child = this.child;
    if (child && generation && this.connectedInterface) {
      // Ask xl2tpd to close the LAC before terminating the group, allowing
      // the peer to release a single-session account before reconnect.
      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const down = new Promise<void>((resolve) => {
        this.downWaiter = { generation, resolve };
      });
      try {
        handle = await fs.open(
          join(this.dir, "control"),
          constants.O_WRONLY | constants.O_NONBLOCK,
        );
        await handle.writeFile("d vpn\n");
        await Promise.race([
          down,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 2000);
          }),
        ]);
      } catch {
        /* Fall back to bounded process-group termination. */
      } finally {
        if (timer) clearTimeout(timer);
        await handle?.close();
        this.downWaiter = null;
      }
    }
    if (child) await terminateProcessGroup(child);
    this.child = null;
    this.connectedInterface = null;
    await this.routeWork;
    if (this.events) {
      this.events.close();
      this.events = null;
    }
    await removeOwnedRoutes((args) => this.runIp(args), this.owned);
    this.owned = [];
    if (this.ownsJournal)
      await fs.unlink(join(this.dir, "routes.json")).catch(() => undefined);
    this.ownsJournal = false;
    for (const name of [
      "ppp-options",
      "xl2tpd.conf",
      "control",
      "xl2tpd.pid",
      "events.sock",
    ])
      await fs.unlink(join(this.dir, name)).catch(() => undefined);
  }
  async diagnose(): Promise<object> {
    return {
      source: "vpn-controller",
      endpointIp: this.endpoint,
      routes: this.owned.map((r) => ({ cidr: r.cidr, interfaceName: r.dev })),
      cwmp: {
        target: "127.0.0.1:7547",
        ...(await tcpProbe("127.0.0.1", 7547)),
      },
      observedAt: new Date().toISOString(),
    };
  }
  async probe(
    host: string,
    port: number,
    localIp: string,
  ): Promise<{ status: string; durationMs: number; observedAt: string }> {
    return tcpProbe(host, port, localIp);
  }
}
