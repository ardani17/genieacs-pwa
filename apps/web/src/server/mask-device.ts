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

// Split CSV text into complete RECORDS. Newlines (LF/CRLF) separate
// records only OUTSIDE double quotes: the engine preserves raw
// newlines inside quoted values, so one logical record can span
// physical lines (RFC 4180). Each record is the exact substring
// between separators, trailing empty record included (a closing
// newline survives the round trip).
function splitCsvRecords(csv: string): string[] {
  const records: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < csv.length; ++i) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"')
          ++i; // escaped quote stays data
        else inQuotes = false;
      }
    } else if (ch === '"') inQuotes = true;
    else if (ch === "\n" || ch === "\r") {
      // Consume CRLF as ONE separator; the record ends BEFORE the \r.
      const sepStart = i;
      if (ch === "\r" && csv[i + 1] === "\n") ++i;
      records.push(csv.slice(start, sepStart));
      start = i + 1;
    }
  }
  records.push(csv.slice(start));
  return records;
}

interface CellSpan {
  start: number;
  end: number; // half-open, includes the cell's original quoting
}

// Cell boundaries inside ONE record (no newlines): commas split only
// outside quotes, `""` inside a quoted cell is a literal quote.
function cellSpans(record: string): CellSpan[] {
  const spans: CellSpan[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < record.length; ++i) {
    const ch = record[i];
    if (inQuotes) {
      if (ch === '"') {
        if (record[i + 1] === '"') ++i;
        else inQuotes = false;
      }
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      spans.push({ start, end: i });
      start = i + 1;
    }
  }
  spans.push({ start, end: record.length });
  return spans;
}

// The cell's VALUE: surrounding quotes dropped and `""` unescaped when
// the cell is quoted; unquoted cells (the engine emits the Parameter
// path and most columns unquoted) pass through as-is.
function cellValue(record: string, span: CellSpan): string {
  const raw = record.slice(span.start, span.end);
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))
    return raw.slice(1, -1).replace(/""/g, '"');
  return raw;
}

// Per-device parameter CSV masking: the engine emits one record per
// parameter ("Parameter" first, "Value" sixth); records whose parameter
// path is a secret carry [REDACTED] as the value instead. Masking works
// on COMPLETE records (a quoted value may span physical lines) and
// replaces only the value cell's bytes — every other byte of the
// export, including quoting and CRLF-continuations of non-secret rows,
// is preserved. The header passes through because its first cell
// ("Parameter") is not a secret path — no positional special-casing, so
// a headerless input still masks its first data record.
export function maskDeviceCsv(csv: string): string {
  const VALUE_COLUMN = 5;
  return splitCsvRecords(csv)
    .map((record) => {
      if (!record) return record;
      const spans = cellSpans(record);
      if (spans.length <= VALUE_COLUMN) return record;
      if (!isSecretParamPath(cellValue(record, spans[0]))) return record;
      const value = spans[VALUE_COLUMN];
      return `${record.slice(0, value.start)}"[REDACTED]"${record.slice(value.end)}`;
    })
    .join("\n");
}
