"use client";

// Read-only diagnostics panel: the ENGINE derives the probe target from
// the authorized device (the browser sends only the device id). Results
// show status + target + duration + evidence; lastInform age is separate
// from probe results. No automatic tasks — the read page never sends
// refresh tasks (the executor arrives with M05).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import type { ApiResult } from "@contracts/api.ts";

interface Check {
  name: string;
  source: string;
  target: string | null;
  status: "ok" | "unreachable" | "timeout" | "unavailable";
  observedAt: string;
  durationMs: number | null;
  evidence: string | null;
}

const STATUS_TEXT: Record<Check["status"], string> = {
  ok: "Terhubung",
  unreachable: "Tidak dapat dihubungi",
  timeout: "Waktu habis",
  unavailable: "Tidak tersedia",
};

export function Diagnostics({ deviceId }: { deviceId: string }) {
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch(
        `/api/app/devices/${encodeURIComponent(deviceId)}/diagnostics`,
        {
          method: "POST",
          headers: { "X-App-Request": "1", Origin: window.location.origin },
        },
      );
      const body = (await res.json()) as ApiResult<{ checks: Check[] }>;
      if (body.ok) setChecks(body.data.checks);
      else setFailed(body.ok === false ? body.error.message : "gagal");
    } catch {
      setFailed("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <p style={{ color: "var(--color-muted)" }}>
        Probe hanya dijalankan ke target resmi perangkat (ConnectionRequestURL);
        host dari pengguna tidak pernah dijangkau.
      </p>
      <Button onClick={run} busy={busy}>
        Jalankan diagnosis
      </Button>
      {failed ? <Status tone="danger">{failed}</Status> : null}
      {checks ? (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th scope="col">Pemeriksaan</th>
              <th scope="col">Status</th>
              <th scope="col">Target</th>
              <th scope="col">Durasi</th>
              <th scope="col">Bukti</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>
                  <Status
                    tone={
                      c.status === "ok"
                        ? "success"
                        : c.status === "unavailable"
                          ? "muted"
                          : "danger"
                    }
                  >
                    {STATUS_TEXT[c.status]}
                  </Status>
                </td>
                <td>{c.target ?? "—"}</td>
                <td>{c.durationMs != null ? `${c.durationMs} ms` : "—"}</td>
                <td>{c.evidence ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
