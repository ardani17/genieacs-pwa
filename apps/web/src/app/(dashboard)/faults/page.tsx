"use client";

// Faults page (M05-E): list/filter/paginate/delete through the BFF
// faults resource — permission enforced server-side per action.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Status } from "@/components/ui/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import type { ApiResult } from "@contracts/api.ts";

interface FaultRow {
  _id: string;
  device: string;
  channel: string;
  code: string;
  message: string;
  timestamp: number;
}

const PAGE_SIZE = 25;

export default function FaultsPage() {
  const [rows, setRows] = useState<FaultRow[]>([]);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "error" | "forbidden"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (filter) params.set("filter", filter);
      const res = await fetch(`/api/app/resources/faults?${params}`, {
        cache: "no-store",
      });
      if (res.status === 403) {
        setState("forbidden");
        return;
      }
      const body = (await res.json()) as ApiResult<{
        items: FaultRow[];
        total: number | null;
      }>;
      if (body.ok !== true) {
        setState("error");
        return;
      }
      setRows(body.data.items);
      setTotal(body.data.total);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [page, filter]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/app/resources/faults/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: { "X-App-Request": "1" },
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => null)) as ApiResult<unknown> | null;
        setError(
          body && body.ok === false
            ? body.error.message
            : "Fault tidak dapat dihapus.",
        );
      } else {
        await load();
      }
    } catch {
      setError("Fault tidak dapat dihapus — koneksi terputus.");
    }
    setBusy(false);
  };

  if (state === "forbidden")
    return (
      <>
        <PageHeader title="Fault" description="Daftar fault perangkat." />
        <Status tone="warning">Anda tidak memiliki izin melihat fault.</Status>
      </>
    );

  const pageCount =
    total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;

  return (
    <>
      <PageHeader
        title="Fault"
        description="Telusuri fault RPC perangkat dan hapus yang sudah ditangani."
      />
      <div className="space-y-4">
        {state === "error" ? (
          <Status tone="danger">Fault tidak dapat dimuat.</Status>
        ) : null}
        {error ? <Status tone="warning">{error}</Status> : null}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                aria-label="Filter fault"
                placeholder='mis. DeviceID.ID LIKE "TEST-%"'
                value={filter}
                onChange={(e) => {
                  setPage(1);
                  setFilter(e.target.value);
                }}
              />
            </div>
            <div className="overflow-hidden rounded-xl border">
              <Table aria-label="Daftar fault" className="min-w-[640px]">
                <TableHeader className="bg-muted/60">
                  <TableRow>
                    {["Perangkat", "Kanal", "Kode", "Pesan", "Waktu", ""].map(
                      (h) => (
                        <TableHead scope="col" key={h}>
                          {h}
                        </TableHead>
                      ),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="font-mono text-xs">
                        {row.device}
                      </TableCell>
                      <TableCell className="text-xs">{row.channel}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.code}
                      </TableCell>
                      <TableCell className="max-w-64 break-all text-xs">
                        {row.message}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.timestamp).toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void remove(row._id)}
                        >
                          Hapus
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >
                {total != null ? `Total ${total}` : "Total tidak tersedia"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Sebelumnya
                </Button>
                <Button
                  variant="outline"
                  disabled={pageCount != null && page >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
