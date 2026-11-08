// Secret-bearing internal requests accept an operator-configured origin only.
// Callers must also reject redirects so credentials stay at that origin.
export function internalServiceUrl(origin: string, path: string): string {
  const base = new URL(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
    throw new Error("INVALID_INTERNAL_ORIGIN");
  const target = new URL(path, base);
  if (target.origin !== base.origin) throw new Error("INVALID_INTERNAL_ORIGIN");
  return target.href;
}
