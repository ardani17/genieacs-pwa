import ipaddr from "ipaddr.js";
import { createHash } from "node:crypto";

export interface OwnedRoute {
  cidr: string;
  dev: string;
  gateway?: string;
  metric: number;
}
export type RunIp = (args: string[]) => Promise<string>;
export const ROUTE_PROTOCOL = "186";

function range(cidr: string): [number, number] {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}\/(?:[12]?\d|3[0-2])$/.test(cidr))
    throw new Error("INVALID_ROUTE");
  const [ip, prefix] = ipaddr.parseCIDR(cidr);
  if (ip.kind() !== "ipv4" || prefix === 0) throw new Error("INVALID_ROUTE");
  const value = ip.toByteArray().reduce((n, b) => n * 256 + b, 0);
  const size = 2 ** (32 - prefix);
  const first = Math.floor(value / size) * size;
  return [first, first + size - 1];
}
export function canonicalRoute(cidr: string): string {
  const [first, last] = range(cidr);
  const octets = [24, 16, 8, 0].map(
    (shift) => Math.floor(first / 2 ** shift) % 256,
  );
  return `${octets.join(".")}/${32 - Math.log2(last - first + 1)}`;
}
export function isRoutedAddress(address: string, routes: string[]): boolean {
  const [value] = range(`${address}/32`);
  return routes.some((cidr) => {
    const [first, last] = range(cidr);
    return value >= first && value <= last;
  });
}
export function validateRoutes(
  routes: string[],
  protectedCidrs: string[],
): string[] {
  if (!Array.isArray(routes) || routes.length > 32)
    throw new Error("INVALID_ROUTE");
  const reserved = protectedCidrs.map(range);
  const normalized = routes.map(canonicalRoute);
  if (new Set(normalized).size !== normalized.length)
    throw new Error("DUPLICATE_ROUTE");
  for (const route of normalized) {
    const [a, b] = range(route);
    if (reserved.some(([c, d]) => a <= d && c <= b))
      throw new Error("PROTECTED_ROUTE_OVERLAP");
  }
  return normalized;
}
export function routeMetric(installationId: string, revision: number): number {
  return (
    10000 +
    (createHash("sha256")
      .update(`${installationId}:${revision}`)
      .digest()
      .readUInt32BE(0) %
      2000000000)
  );
}
export function routeArgs(action: "add" | "del", route: OwnedRoute): string[] {
  canonicalRoute(route.cidr);
  if (
    !/^[a-zA-Z0-9_.-]{1,15}$/.test(route.dev) ||
    !Number.isSafeInteger(route.metric) ||
    route.metric < 10000 ||
    (route.gateway && !ipaddr.IPv4.isValidFourPartDecimal(route.gateway))
  )
    throw new Error("INVALID_OWNED_ROUTE");
  return [
    "-4",
    "route",
    action,
    route.cidr,
    ...(route.gateway ? ["via", route.gateway] : []),
    "dev",
    route.dev,
    "proto",
    ROUTE_PROTOCOL,
    "metric",
    String(route.metric),
  ];
}
// Delete only exact routes recorded for this installation/revision. Never flush.
export async function removeOwnedRoutes(
  run: RunIp,
  routes: OwnedRoute[],
): Promise<void> {
  for (const route of [...routes].reverse()) {
    const args = routeArgs("del", route);
    const actual = JSON.parse(
      await run(["-j", "-N", "-4", "route", "show", "exact", route.cidr]),
    ) as {
      dev: string;
      gateway?: string;
      protocol: string | number;
      metric: number;
    }[];
    if (
      actual.some(
        (r) =>
          r.dev === route.dev &&
          r.gateway === route.gateway &&
          String(r.protocol) === ROUTE_PROTOCOL &&
          r.metric === route.metric,
      )
    )
      await run(args);
  }
}
