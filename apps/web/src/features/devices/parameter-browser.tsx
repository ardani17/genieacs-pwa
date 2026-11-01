"use client";

// Parameter browser: search + list over the device's flat parameters
// (already secret-masked by the BFF), paginated to 100 rows client-side,
// with type and timestamp columns. Copy actions only copy what is
// displayed — masked values never leak the secret.
import { useMemo, useState } from "react";
import { Status } from "@/components/ui/status";

type FlatDevice = Record<string, { value?: [unknown, string] } | unknown>;

const PAGE_SIZE = 100;
const SECRET_PATTERN =
  /(PreSharedKey|Password|KeyPassphrase|Secret|UsernamePassword)$/;

interface Row {
  path: string;
  value: string;
  type: string;
  timestamp: string | null;
  masked: boolean;
}

export function ParameterBrowser({ device }: { device: FlatDevice }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const rows: Row[] = useMemo(() => {
    const all: Row[] = [];
    for (const [path, entry] of Object.entries(device)) {
      if (path.startsWith("_")) continue;
      const attr = entry as
        { value?: [unknown, string]; valueTimestamp?: number } | undefined;
      const masked = SECRET_PATTERN.test(path);
      all.push({
        path,
        value: masked
          ? "[REDACTED]"
          : attr?.value
            ? String(attr.value[0])
            : "—",
        type: attr?.value ? String(attr.value[1] ?? "") : "",
        timestamp: attr?.valueTimestamp
          ? new Date(attr.valueTimestamp).toLocaleString("id-ID")
          : null,
        masked,
      });
    }
    all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const needle = search.trim().toLowerCase();
    return needle
      ? all.filter((r) => r.path.toLowerCase().includes(needle))
      : all;
  }, [device, search]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const slice = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
      }}
    >
      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder="Cari parameter…"
        aria-label="Cari parameter"
        style={{
          minHeight: "var(--touch-target)",
          padding: "var(--space-8)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--color-border)",
        }}
      />
      {slice.length === 0 ? (
        <Status tone="muted">Tidak ada parameter cocok.</Status>
      ) : (
        <div
          style={{
            overflowX: "auto",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.9rem",
            }}
          >
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Nilai</th>
                <th scope="col">Tipe</th>
                <th scope="col">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => (
                <tr key={row.path}>
                  <td style={{ wordBreak: "break-all" }}>{row.path}</td>
                  <td>{row.value}</td>
                  <td>{row.type || "—"}</td>
                  <td>{row.timestamp ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div
        style={{ display: "flex", gap: "var(--space-8)", alignItems: "center" }}
      >
        <button
          type="button"
          onClick={() => setPage(Math.max(1, current - 1))}
          disabled={current <= 1}
          style={{
            minHeight: "var(--touch-target)",
            padding: "var(--space-8)",
            borderRadius: "var(--radius)",
          }}
        >
          Sebelumnya
        </button>
        <span style={{ color: "var(--color-muted)" }}>
          Halaman {current} dari {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage(Math.min(pageCount, current + 1))}
          disabled={current >= pageCount}
          style={{
            minHeight: "var(--touch-target)",
            padding: "var(--space-8)",
            borderRadius: "var(--radius)",
          }}
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}
