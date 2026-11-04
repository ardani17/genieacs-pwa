// Server-side management-WAN guard. The reference form guard
// (wan-model.ts activeManagementWan) only protected the editor flow;
// per docs/design/contracts.md the backend must check the guard before
// EVERY relevant task — including raw setParameterValues/deleteObject on
// the legacy task route. Destructive edits of the active ACS path (or of
// a WAN whose identity is ambiguous) are rejected with VALIDATION and a
// diagnosis instruction; edits of other WAN instances stay allowed, and
// native reboot/factoryReset/download flows are never blocked here.

import { WAN_INSTANCE, value } from "./wan-model.ts";
import type { WanDevice } from "./wan-types.ts";

export class ManagementWanGuardError extends Error {
  code = "VALIDATION";

  constructor(message: string) {
    super(message);
    this.name = "ManagementWanGuardError";
  }
}

export interface GuardedWanTask {
  name: string;
  objectName?: string;
  parameterValues?: [string, unknown, string?][];
}

// Writing any of these on the management instance can sever the ACS
// connection path: mode change, disabling, service list removal,
// address changes.
const CRITICAL_PARAMETERS = new Set([
  "ConnectionType",
  "Enable",
  "X_ZTE-COM_ServiceList",
  "NATEnabled",
  "ExternalIPAddress",
  "AddressingType",
]);

const CRURL_PATH =
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL";

export interface ManagementWanIdentity {
  // WAN instance paths whose ExternalIPAddress matches the connection
  // request host (directly or through server-provided DNS results).
  paths: string[];
  // True when the host matches more than one WAN instance: no single
  // instance can be proven to be THE management path.
  ambiguous: boolean;
}

export function managementWanInstances(
  device: WanDevice,
  resolvedHosts: string[] = [],
): ManagementWanIdentity {
  const requestUrl = value(device, CRURL_PATH);
  let host: string | null = null;
  if (typeof requestUrl === "string" && requestUrl) {
    try {
      host = new URL(requestUrl).hostname;
    } catch {
      host = null;
    }
  }
  if (!host) return { paths: [], ambiguous: false };

  const matches = new Set<string>();
  for (const key of Object.keys(device)) {
    const match = key.match(WAN_INSTANCE);
    if (!match) continue;
    const instance = match[1];
    const ip = value(device, `${instance}.ExternalIPAddress`);
    if (typeof ip !== "string" || !ip || ip === "0.0.0.0") continue;
    // Direct literal match, or the server-resolved address of the CRURL
    // host (DNS names never equal a WAN IP by string comparison).
    if (ip === host || resolvedHosts.includes(ip)) matches.add(instance);
  }
  return { paths: [...matches].sort(), ambiguous: matches.size > 1 };
}

function destructiveTargets(task: GuardedWanTask): string[] {
  // Objects removed by deleteObject: the named object itself plus every
  // instance living underneath a deleted collection.
  if (task.name === "deleteObject" && task.objectName) return [task.objectName];
  return [];
}

function criticalSpvInstances(task: GuardedWanTask): string[] {
  if (task.name !== "setParameterValues") return [];
  const instances = new Set<string>();
  for (const [path] of task.parameterValues ?? []) {
    const match = path.match(WAN_INSTANCE);
    if (!match) continue;
    const leaf = path.slice(match[1].length + 1);
    if (CRITICAL_PARAMETERS.has(leaf)) instances.add(match[1]);
  }
  return [...instances];
}

export function assertManagementWanSafe(
  device: WanDevice,
  tasks: GuardedWanTask[],
  resolvedHosts: string[] = [],
): void {
  const { paths, ambiguous } = managementWanInstances(device, resolvedHosts);
  if (!paths.length) return;

  const reject = (why: string): never => {
    throw new ManagementWanGuardError(
      `VALIDATION ${why} Pindahkan layanan TR069 ke WAN lain atau jalankan diagnosis sebelum mengubah jalur ACS aktif.`,
    );
  };

  for (const task of tasks) {
    for (const instance of criticalSpvInstances(task)) {
      if (!paths.includes(instance)) continue;
      if (ambiguous)
        reject(
          `WAN ${instance} mungkin jalur ACS aktif (alamat WAN tidak unik).`,
        );
      reject(`WAN ${instance} adalah jalur ACS aktif.`);
    }
    for (const target of destructiveTargets(task)) {
      for (const instance of paths) {
        const hit = target === instance || instance.startsWith(`${target}.`);
        if (!hit) continue;
        if (ambiguous)
          reject(
            `Delete ${target} dapat memutus jalur ACS aktif (alamat WAN tidak unik).`,
          );
        reject(`Delete ${target} memutus jalur ACS aktif ${instance}.`);
      }
    }
  }
}
