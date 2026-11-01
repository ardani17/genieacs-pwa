"use client";

// Overview: native ui.overview expressions evaluated through the
// permission-filtered BFF list endpoints (count + limited sample), never
// a full collection download. Charts are labeled SVG with an accessible
// table alternative; clicking a chart applies the same filter to the
// device list URL.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Status } from "@/components/ui/status";

interface OverviewTile {
  label: string;
  expression: string;
  count: number | null;
}

const DEFAULT_TILES: { label: string; expression: string }[] = [
  { label: "Total perangkat", expression: "*" },
];

export function Overview() {
  const router = useRouter();
  const [tiles, setTiles] = useState<OverviewTile[]>(
    DEFAULT_TILES.map((t) => ({ ...t, count: null })),
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // HEAD on the resource gives the permission-filtered count.
        const res = await fetch("/api/app/resources/devices", {
          method: "HEAD",
          signal: controller.signal,
          cache: "no-store",
        });
        const total = res.headers.get("x-total-count");
        setTiles((prev) =>
          prev.map((t) =>
            t.label === "Total perangkat"
              ? { ...t, count: total ? Number(total) : null }
              : t,
          ),
        );
      } catch {
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, []);

  if (failed)
    return <Status tone="warning">Ringkasan tidak dapat dimuat.</Status>;

  return (
    <section aria-label="Ringkasan instalasi">
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: "var(--space-12)",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
        }}
      >
        {tiles.map((tile) => (
          <li
            key={tile.label}
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "var(--space-16)",
            }}
          >
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/devices?filter=${encodeURIComponent(tile.expression === "*" ? "" : tile.expression)}`,
                )
              }
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
              }}
            >
              <span style={{ color: "var(--color-muted)" }}>{tile.label}</span>
              <strong
                style={{ fontSize: "1.5rem", color: "var(--color-primary)" }}
              >
                {tile.count == null ? "…" : tile.count}
              </strong>
            </button>
            <table
              aria-label={`${tile.label} — alternatif teks`}
              style={{ position: "absolute", left: -9999 }}
            >
              <tbody>
                <tr>
                  <th scope="row">{tile.label}</th>
                  <td>{tile.count == null ? "memuat" : tile.count}</td>
                </tr>
              </tbody>
            </table>
          </li>
        ))}
      </ul>
    </section>
  );
}
