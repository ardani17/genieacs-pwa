"use client";

// Parameter actions (M05-E): typed single-parameter edit, object
// refresh/add/delete — all through the M05-B guarded executor (never
// raw task posts). Destructive object operations confirm the literal
// object path; a fresh CWMP read afterwards is labeled as
// configuration verification, not physical-traffic proof.
import { useRef, useState } from "react";
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
import type { ApiResult } from "@contracts/api.ts";
import { OperationResult, type WanOutcome } from "../tasks/operation-result";

type ParamEntry = {
  value?: [unknown, string];
  writable?: boolean;
};

export interface ParameterTarget {
  path: string;
  entry: ParamEntry;
}

const TYPES = [
  "xsd:string",
  "xsd:boolean",
  "xsd:int",
  "xsd:unsignedInt",
] as const;

export function ParameterActions({
  deviceId,
  target,
  objectRoot,
  onApplied,
}: {
  deviceId: string;
  target: ParameterTarget | null;
  objectRoot: string;
  onApplied?: () => void;
}) {
  const [value, setValue] = useState("");
  const [type, setType] = useState<string>("xsd:string");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WanOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<null | "deleteObject">(null);
  const [confirmPath, setConfirmPath] = useState("");
  const operationId = useRef<string | null>(null);

  const send = async (tasks: unknown[]): Promise<void> => {
    setBusy(true);
    setError(null);
    if (!operationId.current) operationId.current = crypto.randomUUID();
    try {
      const res = await fetch(
        `/api/app/devices/${encodeURIComponent(deviceId)}/commands`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-App-Request": "1" },
          body: JSON.stringify({
            operationId: operationId.current,
            deviceId,
            tasks,
          }),
          cache: "no-store",
        },
      );
      const body = (await res.json()) as ApiResult<WanOutcome>;
      if (body.ok !== true) setError(body.error.message);
      else {
        setOutcome(body.data);
        operationId.current = null;
        setValue("");
        onApplied?.();
      }
    } catch {
      setError("Hasil belum terkonfirmasi — koneksi terputus.");
    }
    setBusy(false);
  };

  const typedValue = (): string | number | boolean => {
    if (type === "xsd:boolean") return [true, 1, "1", "true"].includes(value);
    if (type === "xsd:int" || type === "xsd:unsignedInt") return Number(value);
    return value;
  };

  const writable = target?.entry.writable === true;

  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-sm font-semibold">Aksi parameter</h3>
        {outcome ? (
          <div className="space-y-1">
            <OperationResult outcome={outcome} />
            <p className="text-xs text-muted-foreground">
              Pembacaan ulang CWMP adalah verifikasi konfigurasi; bukti trafik
              fisik dinilai pada lab perangkat (M09-B).
            </p>
          </div>
        ) : null}
        {error ? <Status tone="warning">{error}</Status> : null}
        {target ? (
          <div className="space-y-2">
            <p className="break-all text-xs text-muted-foreground">
              {target.path}
              {writable ? " (dapat ditulis)" : " (read-only)"}
            </p>
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                aria-label="Nilai parameter"
                value={value}
                disabled={!writable || busy}
                onChange={(e) => setValue(e.target.value)}
              />
              <Select
                value={type}
                onValueChange={setType}
                disabled={!writable || busy}
              >
                <SelectTrigger aria-label="Tipe nilai" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!writable || busy || !value}
                onClick={() =>
                  void send([
                    {
                      name: "setParameterValues",
                      parameterValues: [[target.path, typedValue(), type]],
                    },
                  ])
                }
              >
                Tulis nilai
              </Button>
            </div>
          </div>
        ) : (
          <Status tone="muted">
            Pilih parameter pada tabel untuk mengubah nilai.
          </Status>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void send([{ name: "refreshObject", objectName: objectRoot }])
            }
          >
            Refresh objek
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !objectRoot}
            onClick={() =>
              void send([{ name: "addObject", objectName: objectRoot }])
            }
          >
            Tambah objek
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || !objectRoot}
            onClick={() => {
              setConfirming("deleteObject");
              setConfirmPath("");
            }}
          >
            Hapus objek
          </Button>
        </div>
        <Dialog
          open={confirming !== null}
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Hapus objek?</DialogTitle>
              <DialogDescription>
                Ketik path objek untuk konfirmasi. Aksi ini destruktif dan
                dijaga guard jalur ACS aktif di server.
              </DialogDescription>
            </DialogHeader>
            <Field label="Konfirmasi path objek" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={confirmPath}
                  autoComplete="off"
                  onChange={(e) => setConfirmPath(e.target.value)}
                />
              )}
            </Field>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={confirmPath !== objectRoot || busy}
                onClick={() => {
                  setConfirming(null);
                  void send([{ name: "deleteObject", objectName: objectRoot }]);
                }}
              >
                Hapus
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
