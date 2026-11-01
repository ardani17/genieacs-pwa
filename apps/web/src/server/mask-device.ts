// Secret masking for flat device values crossing the BFF: parameter
// paths whose VALUES are credentials are replaced before any response
// table/CSV reaches the browser. Users' password/salt never leave the
// engine (the session DTO excludes them), and this is the second layer.

const SECRET_SUFFIXES = [
  "PreSharedKey",
  "Password",
  "KeyPassphrase",
  "Secret",
  "UsernamePassword",
];

export function isSecretParamPath(path: string): boolean {
  return SECRET_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

export function maskDeviceForUi<T extends Record<string, unknown>>(flat: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (isSecretParamPath(key)) {
      out[key] =
        value && typeof value === "object" && "value" in (value as object)
          ? { ...(value as object), value: "[REDACTED]" }
          : "[REDACTED]";
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

// CSV formula-injection guard for exported cells.
export function escapeCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}
