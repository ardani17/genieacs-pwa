"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { apiRequest } from "@/lib/api-client";
import type { VpnStatus } from "@contracts/vpn";

const labels: Record<string, string> = {
  unconfigured: "Belum dikonfigurasi",
  connecting: "Menghubungkan",
  connected: "Terhubung",
  retry_wait: "Menunggu percobaan ulang",
  auth_failed: "Autentikasi ditolak — retry dijeda",
  route_error: "Rute perlu diperbaiki",
  host_unsupported: "Host belum mendukung PPP",
  stopped: "Dihentikan",
  unavailable: "Controller tidak terjangkau",
};
export function VpnStatusPanel({
  canEdit,
  onStatus,
}: {
  canEdit: boolean;
  onStatus?: (status: VpnStatus | null) => void;
}) {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [error, setError] = useState("");
  const [diagnosis, setDiagnosis] = useState<object | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false,
      probing = false;
    const load = async () => {
      if (probing || document.visibilityState === "hidden") return;
      probing = true;
      const result = await apiRequest<VpnStatus>("/api/app/vpn/status", {
        signal: AbortSignal.timeout(8000),
      });
      if (!disposed) {
        if (result.ok === true && "desiredRevision" in result.data) {
          setStatus(result.data);
          onStatus?.(result.data);
          setError("");
        } else {
          setStatus(null);
          onStatus?.(null);
          setError(
            result.ok === true
              ? "Controller tidak terjangkau"
              : `${result.error.message} · requestId ${result.requestId}`,
          );
        }
      }
      probing = false;
    };
    const start = setTimeout(() => void load(), 0);
    const interval = setInterval(() => void load(), 15000);
    const visible = () => void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      clearTimeout(start);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [onStatus]);
  const action = async (kind: "diagnose" | "reconnect") => {
    setBusy(true);
    try {
      const result = await apiRequest<object>(`/api/app/vpn/${kind}`, {
        method: "POST",
        body: "{}",
      });
      if (result.ok === true) {
        setError("");
        if (kind === "diagnose") setDiagnosis(result.data);
        else setStatus(result.data as VpnStatus);
      } else
        setError(`${result.error.message} · requestId ${result.requestId}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-lg font-semibold">Status VPN</h2>
        <p>Dashboard dapat digunakan selama VPN terputus.</p>
        <Status tone={status?.state === "connected" ? "success" : "warning"}>
          {status
            ? (labels[status.state] ?? status.state)
            : "Status VPN belum tersedia"}
        </Status>
        {error ? (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {status ? (
          <dl className="grid grid-cols-2 gap-2 break-words text-sm">
            <dt>Revision diinginkan</dt>
            <dd>{status.desiredRevision}</dd>
            <dt>Revision diterapkan</dt>
            <dd>{status.appliedRevision ?? "—"}</dd>
            <dt>Interface PPP</dt>
            <dd>{status.interfaceName ?? "—"}</dd>
            <dt>IP lokal / peer</dt>
            <dd>
              {status.localIp ?? "—"} / {status.peerIp ?? "—"}
            </dd>
            <dt>Percobaan</dt>
            <dd>{status.attempt}</dd>
            <dt>Percobaan berikutnya</dt>
            <dd>{status.nextAttemptAt ?? "—"}</dd>
            <dt>Error terakhir</dt>
            <dd>{status.lastErrorCode ?? "—"}</dd>
            <dt>Diperiksa</dt>
            <dd>{status.observedAt}</dd>
          </dl>
        ) : null}
        {status?.state === "auth_failed" ? (
          <p>
            Perbaiki profil atau pilih Hubungkan ulang untuk membuka jeda
            autentikasi.
          </p>
        ) : null}
        {status?.routes.length ? (
          <ul className="text-sm">
            {status.routes.map((r) => (
              <li key={r.cidr}>
                {r.cidr} — {r.installed ? "Terpasang" : "Belum terpasang"}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void action("diagnose")}
          >
            Jalankan diagnosis
          </Button>
          {canEdit ? (
            <Button
              disabled={busy || status?.state === "connecting"}
              onClick={() => void action("reconnect")}
            >
              Hubungkan ulang
            </Button>
          ) : null}
        </div>
        {diagnosis ? (
          <div>
            <h3 className="font-medium">Hasil diagnosis</h3>
            <p className="text-sm">
              Kegagalan satu probe belum membuktikan ONT mati.
            </p>
            <pre className="max-w-full overflow-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify(diagnosis, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
