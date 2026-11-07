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

const CRURL_PATHS = [
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL",
  "Device.ManagementServer.ConnectionRequestURL",
];

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
  const requestUrl = CRURL_PATHS.map((p) => value(device, p)).find(
    (v): v is string => typeof v === "string" && !!v,
  );
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

// Every WAN instance path present on the device. When the management
// identity cannot be determined, ANY of these may be the active ACS
// path — this is the candidate set the unidentifiable branch guards.
function wanInstancePaths(device: WanDevice): string[] {
  const instances = new Set<string>();
  for (const key of Object.keys(device)) {
    const match = key.match(WAN_INSTANCE);
    if (match) instances.add(match[1]);
  }
  return [...instances].sort();
}

function criticalSpvInstances(
  task: GuardedWanTask,
  managementPaths: string[] = [],
): string[] {
  if (task.name !== "setParameterValues") return [];
  const instances = new Set<string>();
  for (const [path] of task.parameterValues ?? []) {
    const normalized = trimTrailingDots(path);
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

// Linear-time trailing-dot trim: /\.+$/ is a polynomial regex shape
// (anchored quantifier scanned from every start position), so scan the
// code units instead — paths arrive from admin task payloads.
function trimTrailingDots(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 46) end--;
  return end === path.length ? path : path.slice(0, end);
}

// Normalize an object path the way the engine does before overlap
// checks: no trailing dot, no wildcard suffix, exact segments.
export function normalizeTargetPath(input: string): string {
  let out = trimTrailingDots(input);
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
  const host = crurlHost(device);
  const paths = identity.paths;
  // The management identity is UNKNOWABLE when there is no CRURL at
  // all, or when the CRURL host is a name that resolved to nothing.
  // Missing evidence is not permission: destructive deletes, critical
  // SPV and risky provisions are held against EVERY WAN instance — any
  // of them may be the active ACS path (PR #8 review: critical SPV
  // used to pass here and could sever the unknown management WAN).
  if (paths.length === 0) {
    const hostUnidentifiable =
      host == null || (!/^[0-9.]+$/.test(host) && !host.includes(":"));
    if (hostUnidentifiable) {
      const candidates = wanInstancePaths(device);
      const unidentifiedReject = (what: string): never => {
        throw new ManagementWanGuardError(
          `VALIDATION Jalur manajemen tidak dapat ditentukan (ConnectionRequestURL tidak ada atau host tidak teresolusi); ${what} pada WAN ditahan. Jalankan diagnosis sebelum mengubah WAN.`,
        );
      };
      for (const task of tasks) {
        if (
          task.name === "deleteObject" &&
          task.objectName &&
          touchesWan(task.objectName)
        )
          unidentifiedReject("hapus objek");
        if (candidates.length === 0) continue;
        if (criticalSpvInstances(task, candidates).length)
          unidentifiedReject("SPV kritis");
        if (
          task.name === "provisions" &&
          touchesManagementProvision(task, candidates)
        )
          unidentifiedReject("provision");
      }
    }
    return;
  }

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
  const requestUrl = CRURL_PATHS.map((p) => value(device, p)).find(
    (v): v is string => typeof v === "string" && !!v,
  );
  if (!requestUrl) return null;
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

// Segment-aligned overlap with wildcard support: `arg` overlaps `p`
// when every compared segment is equal (a `*` segment in `arg` matches
// anything) and one path is a segment-prefix of the other. Literal
// prefix comparison missed `WANIPConnection.*.Enable` on the
// identified management instance (PR #8 review).
function pathOverlaps(arg: string, p: string): boolean {
  const a = arg.split(".");
  const b = p.split(".");
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; ++i) {
    if (a[i] !== "*" && b[i] !== "*" && a[i] !== b[i]) return false;
  }
  return true;
}

// A provision arg is risky when it can write a management-critical
// leaf, or when it covers the instance/collection itself (including
// wildcard expansion — the device applies those to every instance).
function riskyProvisionArg(arg: string, managementPaths: string[]): boolean {
  const overlapping = managementPaths.filter((p) => pathOverlaps(arg, p));
  if (!overlapping.length) return false;
  if (arg.split(".").includes("*")) return true;
  if (overlapping.some((p) => arg === p || p.startsWith(`${arg}.`)))
    return true;
  const segments = arg.split(".");
  return CRITICAL_PARAMETERS.has(segments[segments.length - 1]);
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
      // Trailing dots normalize away; only WAN-shaped paths can hit a
      // management instance.
      const normalized = trimTrailingDots(arg);
      if (!WAN_ROOT_PREFIX.test(normalized)) continue;
      if (riskyProvisionArg(normalized, managementPaths)) return true;
    }
  }
  return false;
}
