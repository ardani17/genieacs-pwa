"use client";

// Task/Fault detail tab (contracts.md "Detail tabs"): the device's
// fault history and stored operation outcomes, both read through the
// guarded routes — never raw task payloads.
import { useEffect, useState } from "react";
import { Status } from "@/components/ui/status";
import { DataView, type DataViewProps } from "@/components/ui/data-view";
import type { ApiResult } from "@contracts/api.ts";
import { stringify } from "../../../../../lib/common/expression/parser.ts";

interface FaultRow {
  _id: string;
  code?: string;
  message?: string;
  timestamp?: number;
}

export function DeviceTaskFault({ deviceId }: { deviceId: string }) {
  const [faults, setFaults] = useState<FaultRow[] | null>(null);
  const [state, setState] =
    useState<DataViewProps<FaultRow[]>["state"]>("loading");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      void fetch(
        `/api/app/resources/faults?page=1&pageSize=25&filter=${encodeURIComponent(
          stringify(["=", ["PARAM", "DeviceID.ID"], deviceId]),
        )}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (res) => {
          if (res.status === 403) {
            setState("permission-denied");
            return;
          }
          if (!res.ok) throw new Error("faults unavailable");
          const body = (await res.json()) as ApiResult<{
            items: FaultRow[];
          }>;
          if (body.ok !== true) throw new Error("faults unavailable");
          setFaults(body.data.items);
          setState("ready");
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setState("error");
        });
    }, 0);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [deviceId, reload]);

  return (
    <DataView
      state={state}
      items={faults ?? []}
      onRetry={() => {
        setState("loading");
        setReload((n) => n + 1);
      }}
      renderReady={(items) =>
        items.length ? (
          <ul className="space-y-2">
            {items.map((row) => (
              <li key={row._id} className="rounded-lg border px-3 py-2 text-sm">
                <span className="font-mono text-xs">{row.code ?? "fault"}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {row.timestamp
                    ? new Date(row.timestamp).toLocaleString("id-ID")
                    : ""}
                </span>
                <p className="break-all text-xs">{row.message ?? ""}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Status tone="muted">Tidak ada fault untuk perangkat ini.</Status>
        )
      }
    />
  );
}
