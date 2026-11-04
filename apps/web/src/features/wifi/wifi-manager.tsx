"use client";

// WiFi manager (M05-E): SSID/Enable/key edits are SEPARATE from WAN
// binding. Radios come from the device's real parameters; "keep"
// never sends a key; replacement secrets live only in this form until
// submit. Unsupported security/mapping shows why instead of guessing.
import { useEffect, useRef, useState } from "react";
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
import {
  buildWifiTask,
  readWifi,
  type WifiRadio,
} from "../../../../../packages/device-profiles/src/wifi.ts";
import { OperationResult, type WanOutcome } from "../tasks/operation-result";

type FlatDevice = Record<
  string,
  { value?: [unknown, string]; writable?: boolean }
>;

export function WifiManager({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<FlatDevice | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState<WifiRadio | null>(null);
  const [ssid, setSsid] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [passwordAction, setPasswordAction] = useState<"keep" | "replace">(
    "keep",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WanOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const operationId = useRef<string | null>(null);

  const load = async (): Promise<void> => {
    setState("loading");
    try {
      const res = await fetch(
        `/api/app/devices/${encodeURIComponent(deviceId)}`,
        {
          cache: "no-store",
        },
      );
      const body = (await res.json()) as ApiResult<FlatDevice>;
      if (body.ok !== true) {
        setState("error");
        return;
      }
      setDevice(body.data);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  if (state === "loading") return <Status tone="muted">Memuat WiFi…</Status>;
  if (state === "error" || !device)
    return (
      <div className="space-y-2">
        <Status tone="danger">WiFi tidak dapat dibaca.</Status>
        <Button variant="outline" onClick={() => void load()}>
          Coba lagi
        </Button>
      </div>
    );

  const radios = readWifi(device);

  const openEditor = (radio: WifiRadio): void => {
    setEditing(radio);
    setSsid(radio.ssid);
    setEnabled(radio.enabled);
    setPasswordAction("keep");
    setPassword("");
    setError(null);
    setOutcome(null);
    operationId.current = null;
  };

  const submit = async (): Promise<void> => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      buildWifiTask(device, editing.ssidPath, {
        ssid,
        enabled,
        passwordAction,
        ...(passwordAction === "replace" ? { password } : {}),
      });
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
      return;
    }
    const task = buildWifiTask(device, editing.ssidPath, {
      ssid,
      enabled,
      passwordAction,
      ...(passwordAction === "replace" ? { password } : {}),
    });
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
            tasks: [task],
          }),
          cache: "no-store",
        },
      );
      const body = (await res.json()) as ApiResult<WanOutcome>;
      if (body.ok !== true) setError(body.error.message);
      else setOutcome(body.data);
    } catch {
      setError("Hasil belum terkonfirmasi — koneksi terputus.");
    }
    // The typed secret leaves memory immediately after submit.
    setPassword("");
    setBusy(false);
  };

  if (!radios.length)
    return (
      <Status tone="muted">
        Tidak ada SSID terbaca pada perangkat ini (parameter WLAN tidak
        tersedia).
      </Status>
    );

  return (
    <div className="space-y-4">
      {outcome ? (
        <OperationResult outcome={outcome} onRefresh={() => void load()} />
      ) : null}
      {error ? <Status tone="warning">{error}</Status> : null}
      <Card>
        <CardContent className="space-y-2">
          <ul className="divide-y">
            {radios.map((radio) => (
              <li
                key={radio.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {radio.ssid || "(SSID tanpa nama)"}{" "}
                    {radio.band ? (
                      <span className="text-xs text-muted-foreground">
                        {radio.band}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {radio.enabled ? "Aktif" : "Nonaktif"} ·{" "}
                    {radio.writable ? "dapat diubah" : "read-only"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!radio.writable}
                  onClick={() => openEditor(radio)}
                >
                  Atur SSID
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atur SSID</DialogTitle>
            <DialogDescription>
              Perubahan WiFi terpisah dari binding WAN. Kunci hanya dikirim bila
              Anda memilih ganti.
            </DialogDescription>
          </DialogHeader>
          <Field label="Nama SSID (1–32 byte)">
            {({ id }) => (
              <Input
                id={id}
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Status">
            {({ id }) => (
              <Select
                value={enabled ? "on" : "off"}
                onValueChange={(v) => setEnabled(v === "on")}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">Aktif</SelectItem>
                  <SelectItem value="off">Nonaktif</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Kunci WiFi">
            {({ id }) => (
              <div className="space-y-2">
                <Select
                  value={passwordAction}
                  onValueChange={(v) =>
                    setPasswordAction(v as "keep" | "replace")
                  }
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Pertahankan kunci lama</SelectItem>
                    <SelectItem value="replace">Ganti kunci</SelectItem>
                  </SelectContent>
                </Select>
                {passwordAction === "replace" ? (
                  <Input
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    placeholder="8–63 karakter atau 64 heksadesimal"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                ) : null}
                {passwordAction === "replace" && !editing?.keyPath ? (
                  <Status tone="warning">
                    Perangkat ini belum punya mapping kunci yang dapat ditulis.
                  </Status>
                ) : null}
              </div>
            )}
          </Field>
          <DialogFooter>
            <Button onClick={() => void submit()} busy={busy}>
              Kirim perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
