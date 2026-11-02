"use client";

// Overview: native ui.overview configuration from the session DTO,
// evaluated through the permission-filtered BFF count contract (HEAD
// with the same filter), never a full collection download. Each slice
// shows its count with a text alternative; clicking applies the same
// filter to the device list URL.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Status } from "@/components/ui/status";
import { useSession } from "@/components/session-provider";
import { readOverviewConfig, type OverviewChart } from "./overview-config";

export function Overview() {
  const router = useRouter();
  const { state } = useSession();
  const [failed, setFailed] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [observedAt, setObservedAt] = useState<string | null>(null);
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
    return <Status tone="warning">Ringkasan tidak dapat dimuat.</Status>;

  const charts: OverviewChart[] = baseCharts.map((chart) => ({
    ...chart,
    slices: chart.slices.map((slice) => ({
      ...slice,
      count: counts[`${chart.key}/${slice.key}`] ?? null,
    })),
  }));

  return (
    <section aria-label="Ringkasan instalasi">
      {observedAt && (
        <p style={{ color: "var(--color-muted)" }}>
          Sumber: live · diamati{" "}
          {new Date(observedAt).toLocaleTimeString("id-ID")}
        </p>
      )}
      <div
        style={{
          display: "grid",
          gap: "var(--space-12)",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
        }}
      >
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            padding: "var(--space-16)",
          }}
        >
          <span style={{ color: "var(--color-muted)" }}>Total perangkat</span>
          <strong style={{ fontSize: "1.5rem", color: "var(--color-primary)" }}>
            {total == null ? "…" : total}
          </strong>
        </div>
        {charts.map((chart) => (
          <div
            key={chart.key}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "var(--space-16)",
            }}
          >
            <strong>{chart.label}</strong>
            <table aria-label={`${chart.label} — ringkasan`}>
              <tbody>
                {chart.slices.map((slice) => (
                  <tr key={slice.key}>
                    <th scope="row">{slice.label}</th>
                    <td>
                      {slice.filter ? (
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/devices?filter=${encodeURIComponent(slice.filter ?? "")}`,
                            )
                          }
                          style={{ all: "unset", cursor: "pointer" }}
                        >
                          {slice.count == null ? "…" : slice.count}
                        </button>
                      ) : slice.count == null ? (
                        "—"
                      ) : (
                        String(slice.count)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <table
        aria-label="Ringkasan instalasi — alternatif teks"
        style={{ position: "absolute", left: -9999 }}
      >
        <tbody>
          <tr>
            <th scope="row">Total perangkat</th>
            <td>{total == null ? "memuat" : total}</td>
          </tr>
          {charts.flatMap((chart) =>
            chart.slices.map((slice) => (
              <tr key={`${chart.key}-${slice.key}`}>
                <th scope="row">{`${chart.label}: ${slice.label}`}</th>
                <td>{slice.count == null ? "memuat" : slice.count}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}
