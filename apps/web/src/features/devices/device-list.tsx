"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DataView } from "@/components/ui/data-view";
import { Button } from "@/components/ui/button";
import { FilterBar } from "./filter-bar";

import styles from "./device-list.module.css";
import type { ApiResult, Page } from "@contracts/api.ts";

type FlatDevice = Record<string, { value?: [unknown, string] } | unknown>;

function value(device: FlatDevice, path: string): string {
  const entry = device[path] as { value?: [unknown, string] } | undefined;
  return entry?.value ? String(entry.value[0]) : "";
}

function lastInformText(device: FlatDevice): string {
  const ts = (device["_lastInform"] as { value?: [number, string] } | undefined)
    ?.value;
  if (!ts) return "—";
  return new Date(Number(ts[0])).toLocaleString("id-ID");
}

export function DeviceList() {
  const params = useSearchParams();
  const [state, setState] = useState<"loading" | "ready" | "error" | "empty">(
    "loading",
  );
  const [page, setPage] = useState<Page<FlatDevice> | null>(null);
  const [requestId, setRequestId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string | null>(null);

  const queryText = useMemo(() => params.toString(), [params]);

  useEffect(() => {
    // Debounce rapid typing; abandon older in-flight requests.
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const search = params.get("search");
      const filter = params.get("filter");
      const apiParams = new URLSearchParams(queryText);
      // The BFF builds the native query; the browser passes page/size/
      // sort/filter/search through and the adapter bounds them.
      void search;
      void filter;
      const url = `/api/app/resources/devices?${apiParams.toString()}`;

      fetch(url, { signal: controller.signal, cache: "no-store" })
        .then(async (res) => {
          const body = (await res.json()) as ApiResult<Page<FlatDevice>>;
          if (!body.ok) {
            setRequestId(body.requestId);
            setState("error");
            return;
          }
          setPage(body.data);
          setState(body.data.items.length === 0 ? "empty" : "ready");
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setState("error");
        });
    }, 300);
    lastQueryRef.current = queryText;
    return () => clearTimeout(timer);
  }, [queryText, params]);

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <FilterBar />
      <DataView
        state={state}
        items={page?.items ?? []}
        errorRequestId={requestId}
        onRetry={() => setState("loading")}
        renderReady={(items) => (
          <>
            <div
              className={styles.tableWrap}
              role="region"
              aria-label="Daftar perangkat (tabel)"
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Model</th>
                    <th scope="col">Firmware</th>
                    <th scope="col">Terakhir inform</th>
                    <th scope="col">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((device) => {
                    const id = value(device, "DeviceID.ID");
                    return (
                      <tr key={id}>
                        <td>
                          <a href={`/devices/${encodeURIComponent(id)}`}>
                            {id}
                          </a>
                        </td>
                        <td>{value(device, "DeviceID.ProductClass") || "—"}</td>
                        <td>
                          {value(
                            device,
                            "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
                          ) || "—"}
                        </td>
                        <td>{lastInformText(device)}</td>
                        <td>
                          {value(
                            device,
                            "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
                          ) || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={styles.cards}>
              {items.map((device) => {
                const id = value(device, "DeviceID.ID");
                return (
                  <div className={styles.card} key={id}>
                    <a
                      className={styles.cardId}
                      href={`/devices/${encodeURIComponent(id)}`}
                    >
                      {id}
                    </a>
                    <span className={styles.cardMeta}>
                      {value(device, "DeviceID.ProductClass") || "—"} ·{" "}
                      {value(
                        device,
                        "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
                      ) || "—"}
                    </span>
                    <span className={styles.cardMeta}>
                      {lastInformText(device)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      />
      <div className={styles.pager}>
        <Button
          variant="secondary"
          onClick={() => navigatePage(-1)}
          disabled={currentPage <= 1}
        >
          Sebelumnya
        </Button>
        <span className={styles.mutedText} aria-live="polite">
          Halaman {currentPage}
          {page?.total != null
            ? ` dari ${Math.max(1, Math.ceil(page.total / page.pageSize))}`
            : ""}
        </span>
        <Button
          variant="secondary"
          onClick={() => navigatePage(1)}
          disabled={!hasNext}
        >
          Berikutnya
        </Button>
        <Button variant="secondary" onClick={exportCsv}>
          Ekspor CSV
        </Button>
      </div>
    </div>
  );
}
