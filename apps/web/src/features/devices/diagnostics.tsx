"use client";

// Read-only diagnostics panel: the ENGINE derives the probe target from
// the authorized device (the browser sends only the device id). Results
// show status + target + duration + evidence; lastInform age is separate
// from probe results. No automatic tasks — the read page never sends
// refresh tasks (the executor arrives with M05).
import { useState } from "react";
import { Activity, CircleHelp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      if (!res.ok) {
        // Non-2xx still carries the typed envelope; unparseable bodies
        // fall through to the catch below (same as before).
        const errBody = (await res.json()) as ApiResult<{ checks: Check[] }>;
        if (errBody.ok) setChecks(errBody.data.checks);
        else setFailed(errBody.ok === false ? errBody.error.message : "gagal");
        return;
      }
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
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle role="heading" aria-level={3}>
              Diagnosis koneksi
            </CardTitle>
            <p className="max-w-xl text-sm text-muted-foreground">
              Periksa koneksi ke target resmi perangkat. Hasil mencatat waktu,
              sumber, dan bukti pemeriksaan.
            </p>
          </div>
          <Button onClick={run} busy={busy}>
            <Activity aria-hidden="true" />
            Jalankan diagnosis
          </Button>
        </CardHeader>
      </Card>
      {failed ? <Status tone="danger">{failed}</Status> : null}
      {!checks && !busy ? (
        <Alert>
          <CircleHelp aria-hidden="true" />
          <AlertTitle>Belum ada hasil pemeriksaan</AlertTitle>
          <AlertDescription>
            Jalankan diagnosis untuk melihat kondisi koneksi saat ini.
          </AlertDescription>
        </Alert>
      ) : null}
      {checks ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {checks.map((check) => (
            <Card key={check.name}>
              <CardHeader>
                <CardTitle role="heading" aria-level={4}>
                  {check.name}
                </CardTitle>
                <div>
                  <Status
                    tone={
                      check.status === "ok"
                        ? "success"
                        : check.status === "unavailable"
                          ? "muted"
                          : "danger"
                    }
                  >
                    {STATUS_TEXT[check.status]}
                  </Status>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="detail-grid text-sm">
                  <div>
                    <dt>Target</dt>
                    <dd>{check.target ?? "Belum tersedia"}</dd>
                  </div>
                  <div>
                    <dt>Durasi</dt>
                    <dd>
                      {check.durationMs != null
                        ? check.durationMs + " ms"
                        : "Belum tersedia"}
                    </dd>
                  </div>
                  <div>
                    <dt>Sumber</dt>
                    <dd>{check.source}</dd>
                  </div>
                  <div>
                    <dt>Waktu pemeriksaan</dt>
                    <dd>
                      {new Date(check.observedAt).toLocaleString("id-ID")}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt>Bukti</dt>
                    <dd>{check.evidence ?? "Belum tersedia"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
