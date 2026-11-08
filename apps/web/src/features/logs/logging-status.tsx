"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { Status } from "@/components/ui/status";
type Health = {
  state: string;
  degradedSince: string | null;
  lastSuccessAt: string | null;
  droppedEvents: number;
  collector: { reachable: boolean; bufferBytes: number };
  sinkReachable: boolean;
  observedAt: string;
  storage?: {
    usedBytes: number | null;
    freeBytes: number | null;
    level: string;
  };
};
export function LoggingStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false,
      busy = false;
    const load = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      const result = await apiRequest<Health>("/api/app/logs/status", {
        signal: AbortSignal.timeout(6000),
      });
      if (!disposed) {
        if (result.ok === true) {
          setHealth(result.data);
          setError("");
        } else
          setError(
            `Status logging belum dapat diperiksa · requestId ${result.requestId}`,
          );
      }
      busy = false;
    };
    const first = setTimeout(() => void load(), 0),
      timer = setInterval(() => void load(), 15000);
    return () => {
      disposed = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <Status tone={health?.state === "healthy" ? "success" : "warning"}>
        {health ? `Logging ${health.state}` : "Memeriksa status logging"}
      </Status>
      {health ? (
        <dl className="grid grid-cols-2 gap-2 break-words">
          <dt>Sejak gangguan</dt>
          <dd>{health.degradedSince ?? "—"}</dd>
          <dt>Terakhir berhasil</dt>
          <dd>{health.lastSuccessAt ?? "—"}</dd>
          <dt>Peristiwa hilang</dt>
          <dd>{health.droppedEvents}</dd>
          <dt>Buffer terpakai</dt>
          <dd>{health.collector.bufferBytes} byte</dd>
          <dt>Collector / penyimpanan</dt>
          <dd>
            {health.collector.reachable ? "Terjangkau" : "Tidak terjangkau"} /{" "}
            {health.sinkReachable ? "Terjangkau" : "Tidak terjangkau"}
          </dd>
        </dl>
      ) : null}
      {health?.storage ? (
        <div>
          <p>
            Penyimpanan log: {health.storage.usedBytes ?? "Tidak diketahui"}{" "}
            byte · bebas {health.storage.freeBytes ?? "Tidak diketahui"} byte
          </p>
          {health.storage.level === "warning" ||
          health.storage.level === "critical" ? (
            <p role="alert" className="text-destructive">
              {health.storage.level === "critical"
                ? "Peringatan kritis: penggunaan mencapai 90% target atau ruang bebas di bawah 2 GiB."
                : "Peringatan: penggunaan mencapai 80% target 10 GB."}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="status">{error}</p> : null}
    </div>
  );
}
