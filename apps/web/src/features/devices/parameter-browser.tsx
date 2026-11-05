"use client";

// Parameter browser: search + list over the device's flat parameters
// (already secret-masked by the BFF), paginated to 100 rows client-side,
// with type and timestamp columns. Copy actions only copy what is
// displayed — masked values never leak the secret.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Status } from "@/components/ui/status";

type FlatDevice = Record<string, { value?: [unknown, string] } | unknown>;

const PAGE_SIZE = 100;
const SECRET_PATTERN =
  /(PreSharedKey|Password|KeyPassphrase|Secret|UsernamePassword)$/;

// Locale formatting lives outside the render path (id-ID output is
// identical to the previous inline call).
function formatValueTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString("id-ID");
}

interface Row {
  path: string;
  value: string;
  type: string;
  timestamp: string | null;
  masked: boolean;
}

export function ParameterBrowser({
  device,
  onSelect,
}: {
  device: FlatDevice;
  onSelect?: (target: {
    path: string;
    entry: { value?: [unknown, string]; writable?: boolean };
  }) => void;
}) {
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
          ? formatValueTimestamp(attr.valueTimestamp)
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
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          Parameter perangkat
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {rows.length.toLocaleString("id-ID")} parameter · nilai sensitif
          disamarkan
        </p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <Input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Cari parameter…"
          aria-label="Cari parameter"
        />
        {slice.length === 0 ? (
          <Status tone="muted">Tidak ada parameter cocok.</Status>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table aria-label="Parameter perangkat" className="min-w-[640px]">
              <TableHeader className="bg-muted/60">
                <TableRow>
                  {["Parameter", "Nilai", "Tipe", "Timestamp"].map((label) => (
                    <TableHead scope="col" key={label}>
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map((row) => (
                  <TableRow
                    key={row.path}
                    {...(onSelect
                      ? {
                          onClick: () =>
                            onSelect({
                              path: row.path,
                              entry: device[row.path] as never,
                            }),
                          className: "cursor-pointer",
                        }
                      : {})}
                  >
                    <TableCell className="max-w-80 whitespace-normal break-all font-mono text-xs">
                      {row.path}
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal break-all font-mono text-xs">
                      {row.value}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.type || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.timestamp ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Halaman {current} dari {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPage(Math.max(1, current - 1))}
              disabled={current <= 1}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage(Math.min(pageCount, current + 1))}
              disabled={current >= pageCount}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
