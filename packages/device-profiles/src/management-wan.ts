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
  provisions?: [string, ...unknown[]][];
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

function criticalSpvInstances(
  task: GuardedWanTask,
  managementPaths: string[] = [],
): string[] {
  if (task.name !== "setParameterValues") return [];
  const instances = new Set<string>();
  for (const [path] of task.parameterValues ?? []) {
    const normalized = path.replace(/\.+$/, "");
    // Wildcard segments (…WANIPConnection.*.Enable) expand at the
    // device to EVERY instance under the prefix: flag when any
    // management instance falls under the wildcard prefix.
    const wildcardAt = normalized.indexOf(".*");
    if (wildcardAt !== -1) {
      const prefix = normalized.slice(0, wildcardAt);
      if (managementPaths.some((p) => p.startsWith(`${prefix}.`)))
        instances.add(`${prefix}.*`);
      continue;
    }
    const match = normalized.match(WAN_INSTANCE);
    if (!match) continue;
    const leaf = normalized.slice(match[1].length + 1);
    if (CRITICAL_PARAMETERS.has(leaf)) instances.add(match[1]);
  }
  return [...instances];
}

// Normalize an object path the way the engine does before overlap
// checks: no trailing dot, no wildcard suffix, exact segments.
export function normalizeTargetPath(input: string): string {
  let out = input.replace(/\.+$/, "");
  // A wildcard suffix names the parent collection — collapse it away so
  // overlap checks compare against the collection path itself.
  out = out.replace(/\.\*$/, "");
  return out;
}

export function assertManagementWanSafe(
  device: WanDevice,
  tasks: GuardedWanTask[],
  resolvedHosts: string[] = [],
): void {
  const identity = managementWanInstances(device, resolvedHosts);
  // Without a resolvable CRURL host we cannot know the management path:
  // destructive WAN mutations are refused rather than guessed at
  // (contracts: ambiguity => VALIDATION with diagnosis instruction).
  const hasHost = crurlHost(device) != null;
  const paths = identity.paths;
  if (!paths.length && !hasHost) {
    // No CRURL at all: nothing identifies the management WAN; only
    // destructive operations need the warning path (SPV on unknown
    // instances is harmless because we cannot map them).
    for (const task of tasks) {
      if (
        task.name === "deleteObject" &&
        task.objectName &&
        touchesWan(task.objectName)
      )
        throw new ManagementWanGuardError(
          "VALIDATION Jalur manajemen tidak dapat ditentukan (ConnectionRequestURL tidak ada). Jalankan diagnosis sebelum menghapus objek WAN.",
        );
    }
    return;
  }
  if (!paths.length) return;

  const reject = (why: string): never => {
    throw new ManagementWanGuardError(
      `VALIDATION ${why} Pindahkan layanan TR069 ke WAN lain atau jalankan diagnosis sebelum mengubah jalur ACS aktif.`,
    );
  };

  for (const task of tasks) {
    for (const instance of criticalSpvInstances(task, paths)) {
      const hit = instance.endsWith(".*")
        ? paths.some((p) => p.startsWith(`${instance.slice(0, -2)}.`))
        : paths.includes(instance);
      if (!hit) continue;
      if (identity.ambiguous)
        reject(
          `WAN ${instance} mungkin jalur ACS aktif (alamat WAN tidak unik).`,
        );
      reject(`WAN ${instance} adalah jalur ACS aktif.`);
    }
    for (const target of destructiveTargets(task)) {
      const normalized = normalizeTargetPath(target);
      for (const instance of paths) {
        const hit =
          normalized === instance || instance.startsWith(`${normalized}.`);
        if (!hit) continue;
        if (identity.ambiguous)
          reject(
            `Delete ${target} dapat memutus jalur ACS aktif (alamat WAN tidak unik).`,
          );
        reject(`Delete ${target} memutus jalur ACS aktif ${instance}.`);
      }
    }
    // Provisions that write management-critical leaves through the
    // provision channel bypass the SPV check above — treat any
    // provision whose args reference a management instance path the
    // same way (M05-A review: `provisions` tasks reached the device
    // unguarded).
    if (task.name === "provisions" && touchesManagementProvision(task, paths))
      reject("Provision menyentuh jalur ACS aktif.");
  }
}

function crurlHost(device: WanDevice): string | null {
  const requestUrl = value(device, CRURL_PATH);
  if (typeof requestUrl !== "string" || !requestUrl) return null;
  try {
    return new URL(requestUrl).hostname;
  } catch {
    return null;
  }
}

const WAN_ROOT_PREFIX = /^InternetGatewayDevice\.WANDevice\.\d+/;

function touchesWan(objectName: string): boolean {
  return WAN_ROOT_PREFIX.test(normalizeTargetPath(objectName));
}

interface ProvisionTask extends GuardedWanTask {
  provisions?: [string, ...unknown[]][];
}

function touchesManagementProvision(
  task: GuardedWanTask,
  managementPaths: string[],
): boolean {
  const prov = task as ProvisionTask;
  if (!Array.isArray(prov.provisions)) return false;
  for (const args of prov.provisions) {
    for (const arg of args) {
      if (typeof arg !== "string") continue;
      if (
        managementPaths.some(
          (p) =>
            arg === p || arg.startsWith(`${p}.`) || p.startsWith(`${arg}.`),
        )
      )
        return true;
    }
  }
  return false;
}
