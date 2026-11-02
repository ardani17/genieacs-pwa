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

// Split one CSV line into cells, honouring double-quoted cells with
// embedded commas/escaped quotes (the engine quotes every cell it
// emits).
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; ++i) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '""';
          ++i;
        } else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cells.push(current);
      current = "";
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

// Per-device parameter CSV masking: the engine emits one row per
// parameter ("Parameter" first, "Value" sixth); rows whose parameter
// path is a secret carry [REDACTED] as the value instead. Header rows
// pass through untouched.
export function maskDeviceCsv(csv: string): string {
  const lines = csv.split(/\r?\n/);
  const VALUE_COLUMN = 5;
  return lines
    .map((line, index) => {
      if (index === 0 || !line) return line;
      const cells = splitCsvLine(line);
      if (cells.length <= VALUE_COLUMN) return line;
      const path = cells[0].replace(/^"|"$/g, "");
      if (!isSecretParamPath(path)) return line;
      cells[VALUE_COLUMN] = '"[REDACTED]"';
      return cells.join(",");
    })
    .join("\n");
}
