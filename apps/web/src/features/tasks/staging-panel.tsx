"use client";

// Task staging panel + device actions (M05-D). Everything mutates
// through review: destructive actions require the literal device id;
// the panel commits staged entries one operationId at a time and never
// retries automatically. Offline state disables every mutation.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiError, ApiResult } from "@contracts/api.ts";
import type { TaskInput } from "../../../../../packages/app-contracts/src/commands.ts";
import {
  stagingStore,
  type StagedEntry,
  type StageResult,
} from "./staging-store";
import { OperationResult, type WanOutcome } from "./operation-result";

function apiErrorText(error: ApiError): string {
  if (error.code === "RESULT_UNKNOWN")
    return "Hasil belum terkonfirmasi — koneksi terputus.";
  if (error.code === "FORBIDDEN")
    return "Anda tidak memiliki izin untuk aksi ini.";
  return error.message;
}

export function useStaging(): {
  entries: readonly StagedEntry[];
  stage: (entry: Omit<StagedEntry, "id" | "stagedAt">) => StageResult;
  remove: (id: string) => void;
} {
  const [entries, setEntries] = useState<readonly StagedEntry[]>(() =>
    stagingStore().list(),
  );
  useEffect(
    () => stagingStore().subscribe(() => setEntries(stagingStore().list())),
    [],
  );
  const stage = useCallback(
    (entry: Omit<StagedEntry, "id" | "stagedAt">) =>
      stagingStore().stage(entry),
    [],
  );
  const remove = useCallback((id: string) => stagingStore().remove(id), []);
  return { entries, stage, remove };
}

async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Request": "1" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      // Non-2xx responses still carry the typed envelope; anything
      // unparseable degrades to the same offline result as a throw.
      const errBody = (await res
        .json()
        .catch(() => null)) as ApiResult<T> | null;
      return errBody && typeof errBody === "object" && "ok" in errBody
        ? errBody
        : {
            ok: false,
            error: {
              code: "RESULT_UNKNOWN",
              message: "Network error",
              retryable: false,
            },
            requestId: "unknown",
          };
    }
    return (await res.json()) as ApiResult<T>;
  } catch {
    return {
      ok: false,
      error: {
        code: "RESULT_UNKNOWN",
        message: "Network error",
        retryable: false,
      },
      requestId: "unknown",
    };
  }
}

export function StagingPanel() {
  const { entries, remove } = useStaging();
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [results, setResults] = useState<
    { id: string; outcome?: WanOutcome; error?: string }[]
  >([]);
  // /tasks?operation=<id>: look a stored outcome up by id (the link the
  // OperationResult surface renders) — no resubmission, ever.
  const queryOperation = useSearchParams().get("operation");
  const [lookedUp, setLookedUp] = useState<{
    outcome?: WanOutcome;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!queryOperation) return undefined;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void fetch(`/api/app/operations/${encodeURIComponent(queryOperation)}`, {
        cache: "no-store",
      })
        .then(async (res) => {
          if (cancelled) return;
          if (!res.ok) {
            setLookedUp({ error: "Hasil operasi tidak tersedia." });
            return;
          }
          const body = (await res.json()) as ApiResult<WanOutcome>;
          if (cancelled) return;
          if (body.ok !== true) setLookedUp({ error: body.error.message });
          else setLookedUp({ outcome: body.data });
        })
        .catch(() => {
          if (!cancelled)
            setLookedUp({ error: "Hasil operasi tidak tersedia." });
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [queryOperation]);

  useEffect(() => {
    const sync = (): void => setOffline(!navigator.onLine);
    const initial = window.setTimeout(sync, 0);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const commit = async () => {
    setBusy(true);
    const staged = stagingStore().list();
    const outcomes: { id: string; outcome?: WanOutcome; error?: string }[] = [];
    for (const entry of staged) {
      // One operationId per entry, minted exactly once at commit.
      const operationId = crypto.randomUUID();
      const result =
        entry.kind === "wan"
          ? await postJson<WanOutcome>(
              `/api/app/devices/${encodeURIComponent(entry.deviceId)}/wan`,
              {
                operationId,
                deviceId: entry.deviceId,
                collection: entry.wanTarget?.collection,
                instance: entry.wanTarget?.instance ?? null,
                settings: entry.wanSettings,
              },
            )
          : await postJson<WanOutcome>(
              `/api/app/devices/${encodeURIComponent(entry.deviceId)}/commands`,
              {
                operationId,
                deviceId: entry.deviceId,
                tasks: entry.tasks,
              },
            );
      if (result.ok !== true)
        outcomes.push({ id: entry.id, error: apiErrorText(result.error) });
      else outcomes.push({ id: entry.id, outcome: result.data });
    }
    // Committed entries leave staging regardless of outcome; their
    // results (or unknowns) stay visible below.
    stagingStore().clear();
    setResults(outcomes);
    setBusy(false);
  };

  if (queryOperation) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-sm font-semibold">Hasil operasi</h3>
          {lookedUp?.outcome ? (
            <OperationResult outcome={lookedUp.outcome} />
          ) : lookedUp?.error ? (
            <Status tone="warning">{lookedUp.error}</Status>
          ) : (
            <Status tone="muted">Memuat hasil operasi…</Status>
          )}
          <a
            href="/tasks"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
          >
            Kembali ke staging
          </a>
        </CardContent>
      </Card>
    );
  }

  if (!entries.length && !results.length)
    return (
      <Status tone="muted">
        Belum ada task ter tahankan. Buka perangkat untuk menahankan aksi.
      </Status>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-sm font-semibold">Tinjau sebelum kirim</h3>
          {offline ? (
            <Status tone="warning">
              Sedang offline — mutation dinonaktifkan.
            </Status>
          ) : null}
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {entry.summary.action}
                    {entry.destructive ? " (destruktif)" : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.deviceId}
                    {entry.summary.detail ? ` — ${entry.summary.detail}` : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => remove(entry.id)}
                  disabled={busy || offline}
                >
                  Hapus
                </Button>
              </li>
            ))}
          </ul>
          <Button
            onClick={commit}
            busy={busy}
            disabled={offline || !entries.length}
          >
            Kirim {entries.length} task
          </Button>
        </CardContent>
      </Card>
      {results.map((r) => (
        <Card key={r.id}>
          <CardContent>
            {r.outcome ? (
              <OperationResult outcome={r.outcome} />
            ) : (
              <Status tone="warning">{r.error}</Status>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Destructive device actions with literal-id confirmation. "Jalankan"
// executes immediately (single operation, no retry); "Tahankan" adds
// the action to the staging review flow.
interface FirmwareRow {
  _id: string;
  metadata?: { fileType?: string; version?: string };
}

export function DeviceActions({ deviceId }: { deviceId: string }) {
  const { stage } = useStaging();
  const [dialog, setDialog] = useState<
    null | "reboot" | "factoryReset" | "download"
  >(null);
  const [firmware, setFirmware] = useState<FirmwareRow[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [outcome, setOutcome] = useState<WanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The operationId is minted once per dialog submission attempt and is
  // only read inside handlers — a ref keeps it out of the render state.
  const operationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const taskFor = (): TaskInput[] =>
    dialog === "factoryReset"
      ? [{ name: "factoryReset" }]
      : dialog === "download"
        ? [
            {
              name: "download",
              fileType: "1 Firmware Upgrade Image",
              fileName: selectedFile,
              file: selectedFile,
            },
          ]
        : [{ name: "reboot" }];

  const run = async () => {
    if (dialog === "download" && !selectedFile) {
      setError("Pilih file firmware terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError(null);
    const opId = operationIdRef.current ?? crypto.randomUUID();
    operationIdRef.current = opId;
    const result = await postJson<WanOutcome>(
      `/api/app/devices/${encodeURIComponent(deviceId)}/commands`,
      { operationId: opId, deviceId, tasks: taskFor() },
    );
    setBusy(false);
    if (result.ok !== true) {
      setError(apiErrorText(result.error));
    } else {
      setOutcome(result.data);
      setDialog(null);
    }
  };

  const openDialog = async (which: "reboot" | "factoryReset" | "download") => {
    setDialog(which);
    setConfirmId("");
    setSelectedFile("");
    operationIdRef.current = null;
    setError(null);
    if (which === "download" && !firmware.length) {
      try {
        const res = await fetch(
          "/api/app/resources/files?page=1&pageSize=100",
          { cache: "no-store" },
        );
        if (res.ok) {
          const body = (await res.json()) as ApiResult<{
            items: FirmwareRow[];
          }>;
          if (body.ok === true)
            setFirmware(
              body.data.items.filter(
                (row) =>
                  (row.metadata?.fileType ?? "").includes("Firmware") || true,
              ),
            );
        }
      } catch {
        // list stays empty — picker shows the empty hint
      }
    }
  };

  const stageAction = () => {
    if (!dialog) return;
    stage({
      deviceId,
      kind: "command",
      summary: {
        action:
          dialog === "factoryReset"
            ? "Factory reset"
            : dialog === "download"
              ? `Firmware ${selectedFile}`
              : "Reboot",
        detail: "menunggu review",
      },
      tasks: taskFor(),
      destructive: true,
    });
    setDialog(null);
  };

  // Buttons stay interactive for every authenticated user: the SERVER
  // refusal is the authority and must be visible (not just a disabled
  // menu). canWrite only tunes the visual weight.
  const disabled = offline;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => void openDialog("reboot")}
        >
          Reboot
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={disabled}
          onClick={() => void openDialog("factoryReset")}
        >
          Factory reset
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => void openDialog("download")}
        >
          Unduh firmware
        </Button>
      </div>
      {outcome ? <OperationResult outcome={outcome} /> : null}
      {error ? <Status tone="warning">{error}</Status> : null}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "factoryReset" ? "Factory reset" : "Reboot"}{" "}
              perangkat?
            </DialogTitle>
            <DialogDescription>
              Aksi ini dikirim sekali ke perangkat {deviceId}. Ketik ID
              perangkat untuk konfirmasi.
            </DialogDescription>
          </DialogHeader>
          {dialog === "download" ? (
            <Field label="File firmware" required>
              {({ id }) => (
                <Select value={selectedFile} onValueChange={setSelectedFile}>
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue placeholder="Pilih file" />
                  </SelectTrigger>
                  <SelectContent>
                    {firmware.map((row) => (
                      <SelectItem key={row._id} value={row._id}>
                        {row._id}
                        {row.metadata?.version
                          ? ` (v${row.metadata.version})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : null}
          <Field
            label="Konfirmasi ID perangkat"
            required
            error={
              confirmId && confirmId !== deviceId ? "ID tidak cocok" : undefined
            }
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={confirmId}
                onChange={(e) => setConfirmId(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={stageAction}
              disabled={
                busy || (dialog === "factoryReset" && confirmId !== deviceId)
              }
            >
              Tahankan
            </Button>
            <Button
              onClick={() => void run()}
              busy={busy}
              disabled={
                offline ||
                (dialog === "download" ? !selectedFile : confirmId !== deviceId)
              }
            >
              Jalankan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
