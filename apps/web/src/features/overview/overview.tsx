"use client";

// Overview: native ui.overview configuration from the session DTO,
// evaluated through the permission-filtered BFF count contract (HEAD
// with the same filter), never a full collection download. Each slice
// shows its count with a text alternative; clicking applies the same
// filter to the device list URL.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Cable, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataView } from "@/components/ui/data-view";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { useSession } from "@/components/session-provider";
import { readOverviewConfig, type OverviewChart } from "./overview-config";
import { ConfigRenderer } from "../config-ui/renderer";
import { configChildKey } from "../config-ui/config-node";
import type { ConfigNode } from "../config-ui/config-node";

export function Overview() {
  const router = useRouter();
  const { state } = useSession();
  const [failed, setFailed] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  // Deterministic render clock for config expressions: derived from the
  // observed data timestamp (falls back to epoch until first observe).
  const observedAtMs = observedAt ? Date.parse(observedAt) : 0;
  // Config comes straight from the session DTO (no state copy): the
  // backend stays the authority and the charts re-derive on refresh.
  const baseCharts = useMemo(
    () =>
      state.phase === "authenticated"
        ? readOverviewConfig(
            state.session.uiConfig as Record<string, unknown> | undefined,
          )
        : [],
    [state],
  );
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const customConfig =
    state.phase === "authenticated"
      ? (
          (state.session.uiConfig as Record<string, unknown> | undefined)?.[
            "overview"
          ] as { components?: ConfigNode[] } | undefined
        )?.components
      : undefined;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        // Count contract: HEAD /api/app/resources/devices[?filter=...]
        // returns the permission-filtered X-Total-Count for the SAME
        // criteria the list would use.
        const results = await Promise.all(
          baseCharts.flatMap((chart) =>
            chart.slices.map(
              async (slice): Promise<[string, number | null]> => {
                if (!slice.filter) return [`${chart.key}/${slice.key}`, null];
                const url = `/api/app/resources/devices?filter=${encodeURIComponent(slice.filter)}`;
                const res = await fetch(url, {
                  method: "HEAD",
                  signal: controller.signal,
                  cache: "no-store",
                });
                const header = res.headers.get("x-total-count");
                return [
                  `${chart.key}/${slice.key}`,
                  res.ok && header !== null ? Number(header) : null,
                ];
              },
            ),
          ),
        );

        const totalRes = await fetch("/api/app/resources/devices", {
          method: "HEAD",
          signal: controller.signal,
          cache: "no-store",
        });
        const totalHeader = totalRes.headers.get("x-total-count");
        if (!cancelled) {
          setCounts(Object.fromEntries(results));
          setTotal(
            totalRes.ok && totalHeader !== null ? Number(totalHeader) : null,
          );
          setObservedAt(new Date().toISOString());
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [baseCharts]);

  if (failed)
    return <DataView state="error" items={[]} renderReady={() => null} />;

  const charts: OverviewChart[] = baseCharts.map((chart) => ({
    ...chart,
    slices: chart.slices.map((slice) => ({
      ...slice,
      count: counts[`${chart.key}/${slice.key}`] ?? null,
    })),
  }));

  const textCount = (count: number | null) =>
    count == null
      ? observedAt
        ? "Tidak tersedia"
        : "Memuat…"
      : count.toLocaleString("id-ID");
  return (
    <section aria-label="Ringkasan instalasi" className="space-y-4">
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <p className="text-sm text-white/80">Total perangkat</p>
            <div className="text-3xl font-semibold tracking-tight">
              {total == null && !observedAt ? (
                <Skeleton className="h-10 w-24 bg-white/20" />
              ) : (
                textCount(total)
              )}
            </div>
            <p className="text-sm text-white/80">
              Perangkat yang dapat diakses oleh akun Anda.
            </p>
          </div>
          <Cable className="size-10 text-white/60" aria-hidden="true" />
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Distribusi perangkat</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-2 bg-card">
            <span className="size-1.5 rounded-full bg-primary" />
            Sumber: live
          </Badge>
          {observedAt ? (
            <span className="flex items-center gap-1.5">
              <Clock3 className="size-3.5" aria-hidden="true" />
              Diamati {new Date(observedAt).toLocaleTimeString("id-ID")}
            </span>
          ) : null}
        </div>
      </div>
      {charts.length === 0 && !customConfig?.length ? (
        <DataView
          state={observedAt ? "unavailable" : "loading"}
          items={[]}
          renderReady={() => null}
        />
      ) : null}
      {customConfig?.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          {customConfig.map((child, i) => (
            <ConfigRenderer
              key={configChildKey(child, i)}
              node={child}
              context={{ device: {}, now: observedAtMs }}
            />
          ))}
        </div>
      ) : null}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        {charts.map((chart) => (
          <Card key={chart.key} className="min-w-0">
            <CardHeader>
              <CardTitle role="heading" aria-level={3}>
                {chart.label}
              </CardTitle>
              <CardDescription>
                Pilih jumlah untuk melihat perangkat dengan filter yang sama.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table aria-label={chart.label + " — ringkasan"}>
                <TableBody>
                  {chart.slices.map((slice) => (
                    <TableRow key={slice.key}>
                      <TableHead
                        scope="row"
                        className="w-full whitespace-normal font-normal text-foreground"
                      >
                        <span>{slice.label}</span>
                        {slice.count != null && total != null && total > 0 ? (
                          <div
                            className="mt-2 h-1.5 w-full max-w-64 rounded-full bg-muted"
                            aria-hidden="true"
                          >
                            <div
                              className="h-full rounded-full bg-primary/70"
                              style={{
                                width:
                                  Math.min(100, (slice.count / total) * 100) +
                                  "%",
                              }}
                            />
                          </div>
                        ) : null}
                      </TableHead>
                      <TableCell className="text-right">
                        {slice.filter ? (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              router.push(
                                "/devices?filter=" +
                                  encodeURIComponent(slice.filter ?? ""),
                              )
                            }
                            className="gap-2 text-primary"
                            aria-label={
                              slice.label +
                              ": " +
                              textCount(slice.count ?? null)
                            }
                          >
                            {textCount(slice.count ?? null)}
                            <ArrowUpRight
                              className="size-4"
                              aria-hidden="true"
                            />
                          </Button>
                        ) : (
                          textCount(slice.count ?? null)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="sr-only">
        <table aria-label="Ringkasan instalasi — alternatif teks">
          <tbody>
            <tr>
              <th scope="row">Total perangkat</th>
              <td>{textCount(total)}</td>
            </tr>
            {charts.flatMap((chart) =>
              chart.slices.map((slice) => (
                <tr key={chart.key + "/" + slice.key}>
                  <th scope="row">{chart.label + ": " + slice.label}</th>
                  <td>{textCount(slice.count ?? null)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
