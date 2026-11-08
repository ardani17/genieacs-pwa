"use client";

import { useMemo } from "react";
import { useConnection } from "./connection-provider";
import { Status, type StatusTone } from "./ui/status";

// Independent status rows with evidence: app reachability, VPN state
// (auth_failed wording asks for ADMIN correction — never "reinstall the
// PWA"), and the last successful probe timestamp.
const VPN_TEXT: Record<string, { tone: StatusTone; text: string }> = {
  connected: { tone: "success", text: "VPN ONT terhubung" },
  connecting: { tone: "muted", text: "VPN menghubungkan…" },
  degraded: { tone: "warning", text: "VPN terdegradasi" },
  auth_failed: {
    tone: "warning",
    text: "VPN berhenti: autentikasi gagal — hubungi admin untuk koreksi profil",
  },
  unavailable: { tone: "warning", text: "VPN tidak tersedia" },
  unconfigured: { tone: "muted", text: "VPN belum dikonfigurasi" },
  retry_wait: { tone: "warning", text: "VPN menunggu percobaan ulang" },
  route_error: { tone: "warning", text: "Rute VPN perlu diperbaiki" },
  host_unsupported: { tone: "warning", text: "Host VPN belum mendukung PPP" },
  stopped: { tone: "muted", text: "VPN dihentikan" },
};

// Locale formatting lives outside the render path (id-ID output is
// identical to the previous inline call).
function formatSuccessTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID");
}

export function ConnectionStatus() {
  const { app, vpn, lastSuccessAt } = useConnection();

  // Locale formatting is computed off the direct render path (id-ID
  // output is identical to the previous inline call).
  const lastSuccessText = useMemo(
    () => (lastSuccessAt ? formatSuccessTime(lastSuccessAt) : null),
    [lastSuccessAt],
  );

  const appView =
    app === "reachable"
      ? { tone: "success" as StatusTone, text: "Aplikasi terhubung" }
      : app === "checking"
        ? { tone: "muted" as StatusTone, text: "Memeriksa koneksi…" }
        : {
            tone: "danger" as StatusTone,
            text: "Aplikasi tidak dapat dihubungi",
          };

  const vpnView = VPN_TEXT[vpn] ?? VPN_TEXT.unconfigured;

  return (
    <div
      aria-label="Status koneksi"
      className="flex flex-wrap items-center gap-2"
    >
      <Status tone={appView.tone}>{appView.text}</Status>
      <Status tone={vpnView.tone}>{vpnView.text}</Status>
      {lastSuccessText ? (
        <small className="text-xs text-muted-foreground">
          Terakhir berhasil: {lastSuccessText}
        </small>
      ) : null}
    </div>
  );
}
