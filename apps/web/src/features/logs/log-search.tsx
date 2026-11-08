"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/components/session-provider";
import { hasResourceAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { buildLogQuery, type LogFilters } from "@contracts/log-query";
import { LoggingStatus } from "./logging-status";

const localTime = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export function LogSearch({
  initialRequestId = "",
}: {
  initialRequestId?: string;
}) {
  const { state } = useSession();
  const canRead =
    state.phase === "authenticated" &&
    hasResourceAccess(state.session, "logs", 2);
  const canExport =
    state.phase === "authenticated" &&
    hasResourceAccess(state.session, "logs", 3);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setStart(localTime(new Date(Date.now() - 15 * 60000)));
      setEnd(localTime(new Date()));
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const [service, setService] = useState("");
  const [level, setLevel] = useState("");
  const [requestId, setRequestId] = useState(initialRequestId);
  const [operationId, setOperationId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState<LogFilters | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const search = async (nextOffset?: number, exporting = false) => {
    setBusy(true);
    setError("");
    try {
      // Paging and export reuse the exact executed filters, independent of
      // edits to the form while the user inspects an existing result page.
      const filters: LogFilters =
        nextOffset !== undefined || exporting
          ? {
              ...(query ?? {}),
              offset: exporting ? 0 : nextOffset,
              limit: exporting ? 10000 : 100,
            }
          : {
              start: new Date(start).toISOString(),
              end: new Date(end).toISOString(),
              ...(service ? { service } : {}),
              ...(level ? { level: level as LogFilters["level"] } : {}),
              ...(requestId ? { requestId } : {}),
              ...(operationId ? { operationId } : {}),
              ...(deviceId ? { deviceId } : {}),
              limit: 100,
              offset: 0,
            };
      buildLogQuery(filters, exporting ? { limitMax: 10000 } : {});
      const response = await fetch(
        exporting ? "/api/app/logs/export" : "/api/app/logs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-App-Request": "1" },
          body: JSON.stringify(filters),
          cache: "no-store",
          signal: AbortSignal.timeout(exporting ? 35000 : 10000),
        },
      );
      if (!response.ok) {
        let message = "Log tidak tersedia";
        try {
          const payload = await response.json();
          message = `${payload.error?.message ?? message} · requestId ${payload.requestId ?? response.headers.get("x-request-id") ?? "unknown"}`;
        } catch {
          /* safe fallback */
        }
        setError(
          response.status === 503
            ? `Logging degraded. ${message}. Coba lagi; koreksi VPN tetap dapat dilakukan.`
            : message,
        );
        return;
      }
      const text = await response.text();
      if (exporting) {
        const url = URL.createObjectURL(
          new Blob([text], { type: "application/x-ndjson" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "genieacs-logs.ndjson";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      const result = text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      setRows(result);
      setOffset(nextOffset ?? 0);
      setQuery(filters);
    } catch {
      setError("Pencarian gagal. Periksa filter/waktu dan coba lagi.");
    } finally {
      setBusy(false);
    }
  };
  if (!canRead) return <p>Tidak ada izin membaca log global.</p>;
  const input = (
    label: string,
    value: string,
    set: (v: string) => void,
    type = "text",
  ) => (
    <Field label={label}>
      {({ id }) => (
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </Field>
  );
  return (
    <Card>
      <CardContent className="space-y-4">
        <LoggingStatus />
        <p className="text-sm text-muted-foreground">
          Retensi 14 hari · target penyimpanan 10 GB · buffer 1 GiB. Pencarian
          awal 15 menit; maksimum rentang 24 jam, 100 baris per halaman.
        </p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          {input("Dari", start, setStart, "datetime-local")}
          {input("Sampai", end, setEnd, "datetime-local")}
          {input("Layanan", service, setService)}
          <Field label="Level">
            {({ id }) => (
              <select
                id={id}
                className="min-h-11 w-full rounded-md border bg-background p-2"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="">Semua level</option>
                {["debug", "info", "warn", "error"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {input("Request ID", requestId, setRequestId)}
          {input("Operation ID", operationId, setOperationId)}
          {input("Device ID", deviceId, setDeviceId)}
          <div className="flex items-end">
            <Button type="submit" disabled={busy || !start || !end}>
              Cari log
            </Button>
          </div>
        </form>
        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void search()}
            >
              Coba lagi
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || offset === 0}
            onClick={() => void search(Math.max(0, offset - 100))}
          >
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            disabled={busy || rows.length < 100 || offset >= 5000}
            onClick={() => void search(offset + 100)}
          >
            Berikutnya
          </Button>
          {canExport ? (
            <Button
              variant="outline"
              disabled={busy || !query}
              onClick={() => void search(0, true)}
            >
              Ekspor log (maks. 10.000)
            </Button>
          ) : null}
        </div>
        <p className="text-sm">
          {rows.length} hasil · halaman {Math.floor(offset / 100) + 1}
        </p>
        <div className="space-y-3">
          {rows.map((row, i) => (
            <details key={`${offset}-${i}`} className="rounded-lg border p-3">
              <summary className="cursor-pointer break-words text-sm">
                {String(row.timestamp ?? row._time ?? "")} ·{" "}
                {String(row.level ?? "")} ·{" "}
                {String(row.message ?? row._msg ?? row.event ?? "Log")}
              </summary>
              {typeof row.requestId === "string" ? (
                <a
                  className="mt-2 inline-block text-sm text-primary underline"
                  href={`/diagnostics/logs?requestId=${encodeURIComponent(row.requestId)}`}
                >
                  Telusuri requestId {row.requestId}
                </a>
              ) : null}
              <pre className="mt-3 max-w-full overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(row, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
