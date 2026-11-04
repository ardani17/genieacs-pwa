"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DataView, type DataViewProps } from "@/components/ui/data-view";
import { Button } from "@/components/ui/button";
import { FilterBar } from "./filter-bar";

import { ArrowLeft, ArrowRight, ArrowUpRight, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiResult, Page } from "@contracts/api.ts";

type FlatDevice = Record<string, { value?: [unknown, string] } | unknown>;

function value(device: FlatDevice, path: string): string {
  const entry = device[path] as { value?: [unknown, string] } | undefined;
  return entry?.value ? String(entry.value[0]) : "";
}

function lastInformText(device: FlatDevice): string {
  const ts = value(device, "Events.Inform") || value(device, "_lastInform");
  if (!ts) return "Belum tersedia";
  const date = new Date(Number.isFinite(Number(ts)) ? Number(ts) : ts);
  return Number.isNaN(date.getTime())
    ? "Belum tersedia"
    : date.toLocaleString("id-ID");
}

export function DeviceList() {
  const params = useSearchParams();
  const [state, setState] =
    useState<DataViewProps<FlatDevice>["state"]>("loading");
  const [page, setPage] = useState<Page<FlatDevice> | null>(null);
  const [requestId, setRequestId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const [reload, setReload] = useState(0);

  const queryText = useMemo(() => params.toString(), [params]);

  useEffect(() => {
    // Debounce rapid typing; abandon older in-flight requests.
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState("loading");
      setRequestId(undefined);
      const apiParams = new URLSearchParams(queryText);
      // The BFF builds the native query; the browser passes page/size/
      // sort/filter/search through and the adapter bounds them.
      const url = `/api/app/resources/devices?${apiParams.toString()}`;

      fetch(url, { signal: controller.signal, cache: "no-store" })
        .then(async (res) => {
          const body = (await res.json()) as ApiResult<Page<FlatDevice>>;
          if (controller.signal.aborted) return;
          if (body.ok === false) {
            setPage(null);
            setRequestId(body.requestId);
            setState(
              body.error.code === "FORBIDDEN"
                ? "permission-denied"
                : body.error.code === "BACKEND_UNAVAILABLE"
                  ? "unavailable"
                  : "error",
            );
            return;
          }
          setPage(body.data);
          setState(body.data.items.length === 0 ? "empty" : "ready");
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setPage(null);
          setState("error");
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [queryText, params, reload]);

  const currentPage = page?.page ?? 1;
  const hasNext = page?.hasNext ?? false;

  function navigatePage(delta: number) {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(Math.max(1, currentPage + delta)));
    window.history.replaceState(null, "", `/devices?${next.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function exportCsv() {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    window.location.href = `/api/app/resources/devices/csv?${next.toString()}`;
  }

  return (
    <div className="min-w-0 space-y-6">
      <FilterBar />
      <Card className="min-w-0 gap-0 overflow-hidden pb-0">
        <CardHeader className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle role="heading" aria-level={2}>
              Daftar perangkat
            </CardTitle>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {page?.total != null
                ? page.total.toLocaleString("id-ID") + " perangkat ditemukan"
                : "Hasil berdasarkan filter dan izin akun"}
            </p>
          </div>
          <Button variant="outline" onClick={exportCsv}>
            <Download aria-hidden="true" />
            Ekspor CSV
          </Button>
        </CardHeader>
        <DataView
          state={state}
          items={page?.items ?? []}
          errorRequestId={requestId}
          onRetry={() => {
            setState("loading");
            setReload((n) => n + 1);
          }}
          renderReady={(items) => (
            <>
              <div
                className="hidden min-w-0 md:block"
                role="region"
                aria-label="Daftar perangkat (tabel)"
              >
                <Table>
                  <TableHeader className="bg-muted/60">
                    <TableRow>
                      {["ID", "Model", "Firmware", "Terakhir inform", "IP"].map(
                        (label) => (
                          <TableHead scope="col" key={label} className="px-6">
                            {label}
                          </TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((device) => {
                      const id = value(device, "DeviceID.ID");
                      return (
                        <TableRow key={id}>
                          <TableCell className="px-6">
                            <a
                              className="inline-flex min-h-11 items-center gap-2 font-medium text-primary hover:underline"
                              href={"/devices/" + encodeURIComponent(id)}
                            >
                              {id}
                              <ArrowUpRight
                                className="size-3.5"
                                aria-hidden="true"
                              />
                            </a>
                          </TableCell>
                          <TableCell className="px-6">
                            {value(device, "DeviceID.ProductClass") || "—"}
                          </TableCell>
                          <TableCell className="px-6">
                            {value(
                              device,
                              "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
                            ) || "—"}
                          </TableCell>
                          <TableCell className="px-6 text-muted-foreground">
                            {lastInformText(device)}
                          </TableCell>
                          <TableCell className="px-6 font-mono text-xs">
                            {value(
                              device,
                              "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
                            ) || "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y border-t md:hidden">
                {items.map((device) => {
                  const id = value(device, "DeviceID.ID");
                  return (
                    <CardContent key={id} className="space-y-3 py-4">
                      <a
                        href={"/devices/" + encodeURIComponent(id)}
                        className="flex min-h-11 items-center justify-between gap-2 break-all text-sm font-semibold text-primary"
                      >
                        {id}
                        <ArrowUpRight
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                      </a>
                      <dl className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <dt className="text-muted-foreground">Model</dt>
                          <dd className="mt-1 font-medium">
                            {value(device, "DeviceID.ProductClass") || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Firmware</dt>
                          <dd className="mt-1 font-medium">
                            {value(
                              device,
                              "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
                            ) || "—"}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-muted-foreground">
                            Terakhir inform
                          </dt>
                          <dd className="mt-1">{lastInformText(device)}</dd>
                        </div>
                      </dl>
                    </CardContent>
                  );
                })}
              </div>
            </>
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 md:px-6">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Halaman {currentPage}
            {page?.total != null
              ? " dari " + Math.max(1, Math.ceil(page.total / page.pageSize))
              : ""}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigatePage(-1)}
              disabled={state === "loading" || currentPage <= 1}
            >
              <ArrowLeft aria-hidden="true" />
              <span>Sebelumnya</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => navigatePage(1)}
              disabled={state === "loading" || !hasNext}
            >
              <span>Berikutnya</span>
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
