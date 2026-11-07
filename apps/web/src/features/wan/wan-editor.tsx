"use client";

// WAN editor (M05-D): controlled by {deviceId, collection, instance}.
// The browser only renders form settings — the complete typed task is
// rebuilt server-side (M05-C). Unverified firmware is read-only
// (UNSUPPORTED_PROFILE); switching target resets the form and drops
// any typed secret; the operationId is minted once per submission.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import type { ApiResult } from "@contracts/api.ts";
import {
  buildWanTask,
  connectionModes,
  readSettings,
} from "../../../../../packages/device-profiles/src/wan-model.ts";
import type {
  WanDevice,
  WanSettings,
} from "../../../../../packages/device-profiles/src/wan-types.ts";
import type { DeviceProfile } from "../../../../../packages/device-profiles/src/types.ts";
import { WanForm } from "./wan-form";
import { OperationResult, type WanOutcome } from "../tasks/operation-result";
import { stagingStore } from "../tasks/staging-store";

type FlatDevice = Record<
  string,
  { value?: [unknown, string]; writable?: boolean }
>;

function lanOptions(device: WanDevice): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (const key of Object.keys(device)) {
    const match = key.match(
      /^(InternetGatewayDevice\.LANDevice\.\d+\.(LANEthernetInterfaceConfig|WLANConfiguration)\.\d+)$/,
    );
    if (match) {
      const ssid = device[`${match[1]}.SSID`]?.value?.[0];
      options.push({
        value: match[1],
        label: ssid
          ? `${match[2] === "WLANConfiguration" ? "SSID" : "LAN"} ${ssid}`
          : match[1],
      });
    }
  }
  return options;
}

export function WanEditor({
  deviceId,
  collection,
  instance,
}: {
  deviceId: string;
  collection: string;
  instance: string | null;
}) {
  const [device, setDevice] = useState<WanDevice | null>(null);
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [settings, setSettings] = useState<WanSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WanOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const operationId = useRef<string | null>(null);

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

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    setOutcome(null);
    operationId.current = null;
    try {
      const [deviceRes, profileRes] = await Promise.all([
        fetch(`/api/app/devices/${encodeURIComponent(deviceId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/app/devices/${encodeURIComponent(deviceId)}/profile`, {
          cache: "no-store",
        }),
      ]);
      if (!deviceRes.ok || !profileRes.ok) {
        // Non-2xx carries the typed error envelope; the shared error
        // state covers it exactly like an ok:false body below.
        setState("error");
        return;
      }
      const deviceBody = (await deviceRes.json()) as ApiResult<FlatDevice>;
      const profileBody = (await profileRes.json()) as ApiResult<{
        profile: DeviceProfile;
      }>;
      if (deviceBody.ok !== true || profileBody.ok !== true) {
        setState("error");
        return;
      }
      setDevice(deviceBody.data as unknown as WanDevice);
      setProfile(profileBody.data.profile);
      // Target switch resets the form: secrets from a previous target
      // never survive.
      setSettings(
        readSettings(
          deviceBody.data as unknown as WanDevice,
          instance ?? collection,
        ),
      );
      setState("ready");
    } catch {
      setState("error");
    }
  }, [deviceId, collection, instance]);

  useEffect(() => {
    // Async loader runs off the effect body so the synchronous
    // setState at its start cannot cascade renders.
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (state === "loading") return <Status tone="muted">Memuat WAN…</Status>;
  if (state === "error" || !device || !settings)
    return (
      <div className="space-y-2">
        <Status tone="danger">WAN tidak dapat dibaca.</Status>
        <Button variant="outline" onClick={() => void load()}>
          Coba lagi
        </Button>
      </div>
    );

  if (profile && !profile.wan)
    return (
      <Status tone="warning">
        Firmware perangkat ini belum terverifikasi untuk perubahan WAN —
        parameter tetap dapat dibaca pada tab Parameter.
      </Status>
    );

  const modes = connectionModes(device, instance ?? collection);
  const isPpp = collection.endsWith("WANPPPConnection");

  // Client-side preview of the server's validation (same pure model):
  const preview = (() => {
    try {
      buildWanTask(device, collection, instance, settings);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  })();

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (!operationId.current) operationId.current = crypto.randomUUID();
    const apply = (result: ApiResult<WanOutcome>): void => {
      if (result.ok !== true) {
        if (result.error.code === "RESULT_UNKNOWN")
          setError("Hasil belum terkonfirmasi — koneksi terputus.");
        else setError(result.error.message);
      } else {
        setOutcome(result.data);
      }
    };
    try {
      const res = await fetch(
        `/api/app/devices/${encodeURIComponent(deviceId)}/wan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-App-Request": "1" },
          body: JSON.stringify({
            operationId: operationId.current,
            deviceId,
            collection,
            instance,
            settings,
          }),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        // Non-2xx still carries the typed envelope; unparseable bodies
        // fall through to the catch below (same as before).
        apply((await res.json()) as ApiResult<WanOutcome>);
        return;
      }
      apply((await res.json()) as ApiResult<WanOutcome>);
    } catch {
      setError("Hasil belum terkonfirmasi — koneksi terputus.");
    } finally {
      // busy ALWAYS releases (STD-06: an early HTTP-error return used
      // to leave the editor un-submittable until the dialog closed) and
      // the typed secret leaves memory on EVERY exit, success or not.
      setSettings((current) => ({ ...current, password: "" }));
      setBusy(false);
    }
  };

  const stageWan = () => {
    stagingStore().stage({
      deviceId,
      kind: "wan",
      summary: {
        action: `WAN ${instance ? "ubah" : "tambah"}`,
        detail: `${settings.mode}${settings.vlanEnable ? ` VLAN ${settings.vlan}` : ""}`,
      },
      tasks: [],
      wanTarget: { collection, instance },
      wanSettings: { ...settings },
      destructive: /_Bridged$/i.test(settings.mode) || !settings.enable,
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <WanForm
          settings={settings}
          onChange={setSettings}
          modes={modes}
          isPpp={isPpp}
          lanOptions={lanOptions(device)}
          disabled={offline}
        />
        {preview ? <Status tone="warning">{preview}</Status> : null}
        {error ? <Status tone="warning">{error}</Status> : null}
        {outcome ? (
          <OperationResult outcome={outcome} onRefresh={() => void load()} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={submit} busy={busy} disabled={!!preview || offline}>
            {instance ? "Terapkan" : "Tambah WAN"}
          </Button>
          <Button
            variant="outline"
            onClick={stageWan}
            disabled={!!preview || offline}
          >
            Tahankan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
