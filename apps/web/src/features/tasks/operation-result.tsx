"use client";

// Operation result: renders EVERY phase of a command outcome. Unknown
// results say so explicitly — a lost HTTP connection is never rendered
// as success, and the refresh path re-reads the stored outcome by id.
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import type { CommandOutcome } from "../../../../../packages/app-contracts/src/commands.ts";

const PHASE_LABELS: Record<string, string> = {
  write: "Penulisan",
  refresh: "Refresh",
  reapply_binding: "Reapply binding",
  verify: "Verifikasi",
  execute: "Eksekusi",
};

const STATE_LABELS: Record<string, string> = {
  in_progress: "Berjalan",
  succeeded: "Selesai",
  failed: "Gagal",
  partial: "Sebagian",
  unknown: "Belum terkonfirmasi",
};

export interface WanOutcome extends CommandOutcome {
  observedInstance?: string;
  warnings?: string[];
}

export function OperationResult({
  outcome,
  onRefresh,
  refreshing,
}: {
  outcome: WanOutcome;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="space-y-3" aria-live="polite">
      {outcome.state === "succeeded" ? (
        <Status tone="success">Berhasil</Status>
      ) : outcome.state === "failed" ? (
        <Status tone="danger">Perintah gagal.</Status>
      ) : outcome.state === "partial" ? (
        <Status tone="warning">
          Sebagian berhasil — periksa fase di bawah.
        </Status>
      ) : outcome.state === "unknown" ? (
        <Status tone="warning">
          Hasil belum terkonfirmasi. Koneksi atau konfirmasi perangkat hilang;
          gunakan tombol periksa hasil.
        </Status>
      ) : (
        <Status tone="muted">Sedang berjalan…</Status>
      )}
      <ol className="space-y-1 text-sm">
        {outcome.phases.map((phase) => (
          <li
            key={phase.name}
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
          >
            <span>{PHASE_LABELS[phase.name] ?? phase.name}</span>
            <span className="flex items-center gap-2">
              {phase.faultCode ? (
                <span className="font-mono text-xs text-danger">
                  fault {phase.faultCode}
                </span>
              ) : null}
              <span>{STATE_LABELS[phase.state] ?? phase.state}</span>
            </span>
          </li>
        ))}
      </ol>
      {outcome.observedInstance ? (
        <p className="text-sm text-muted-foreground">
          Instance teramati: <code>{outcome.observedInstance}</code>
        </p>
      ) : null}
      {outcome.warnings?.length ? (
        <ul className="list-inside list-disc text-sm text-warning">
          {outcome.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {onRefresh ? (
          <Button variant="outline" onClick={onRefresh} busy={refreshing}>
            Periksa hasil
          </Button>
        ) : null}
        <a
          className="inline-flex min-h-(--control-height-sm) items-center text-sm text-primary hover:underline"
          href={`/tasks?operation=${encodeURIComponent(outcome.operationId)}`}
        >
          Lihat detail operasi
        </a>
      </div>
    </div>
  );
}
