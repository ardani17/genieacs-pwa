"use client";

// Device detail: contract tabs (Ringkasan/WAN/WiFi/Parameter/Diagnosis).
// Unavailable values show "Belum tersedia"; parameter timestamps are
// visible; read pages never send tasks automatically.
import { useEffect, useState } from "react";
import { DataView, type DataViewProps } from "@/components/ui/data-view";
import { ArrowLeft, Router } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Status } from "@/components/ui/status";
import { ParameterBrowser } from "./parameter-browser";
import { Diagnostics } from "./diagnostics";
import { DeviceActions } from "../tasks/staging-panel";
import { WanEditor } from "../wan/wan-editor";
import { useSession } from "@/components/session-provider";
import type { ApiResult } from "@contracts/api.ts";

type FlatDevice = Record<string, { value?: [unknown, string] } | unknown>;

const TABS = ["Ringkasan", "WAN", "WiFi", "Parameter", "Diagnosis"] as const;
type Tab = (typeof TABS)[number];

function val(device: FlatDevice | null, path: string): string {
  const entry = device?.[path] as { value?: [unknown, string] } | undefined;
  return entry?.value ? String(entry.value[0]) : "";
}

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { state: session } = useSession();
  const [tab, setTab] = useState<Tab>("Ringkasan");
  const [state, setState] =
    useState<DataViewProps<FlatDevice>["state"]>("loading");
  const [reload, setReload] = useState(0);
  const [device, setDevice] = useState<FlatDevice | null>(null);
  const [requestId, setRequestId] = useState<string | undefined>();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/app/devices/${encodeURIComponent(deviceId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json()) as ApiResult<FlatDevice>;
        if (controller.signal.aborted) return;
        if (body.ok !== true) {
          setRequestId(body.requestId);
          setState(
            body.ok === false && body.error.code === "NOT_FOUND"
              ? "empty"
              : body.error.code === "FORBIDDEN"
                ? "permission-denied"
                : body.error.code === "BACKEND_UNAVAILABLE"
                  ? "unavailable"
                  : "error",
          );
          return;
        }
        setDevice(body.data);
        setState("ready");
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [deviceId, reload]);

  const lastInform = val(device, "Events.Inform");

  // First WAN IP instance/collection from the flat device: every entry
  // point (row, Atur, Tambah) opens the SAME full editor server-side.
  // An instance node wins over the bare collection key so an existing
  // connection opens in edit (not add) mode.
  const keys = Object.keys(device ?? {});
  const wanInstance =
    keys.find((k) =>
      /^InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANIPConnection\.\d+$/.test(
        k,
      ),
    ) ?? null;
  const wanCollection =
    keys.find((k) =>
      /^InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANIPConnection$/.test(
        k,
      ),
    ) ??
    (wanInstance ? wanInstance.replace(/\.\d+$/, "") : null) ??
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection";

  const fields: Record<string, [string, string][]> = {
    Ringkasan: [
      ["Model", "DeviceID.ProductClass"],
      ["Firmware", "InternetGatewayDevice.DeviceInfo.SoftwareVersion"],
      ["Serial", "DeviceID.SerialNumber"],
      ["Terakhir inform", "Events.Inform"],
      ["Uptime", "InternetGatewayDevice.DeviceInfo.UpTime"],
    ],
    WAN: [
      [
        "IP eksternal",
        "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
      ],
      [
        "Mode",
        "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionType",
      ],
    ],
    WiFi: [
      ["SSID", "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID"],
    ],
  };
  return (
    <div className="min-w-0 space-y-6">
      <a
        href="/devices"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Kembali ke perangkat
      </a>
      <Card>
        <CardContent className="flex items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <Router aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="mb-1 text-xs text-muted-foreground">ID perangkat</p>
            <h2 className="break-all text-base font-semibold md:text-xl">
              {deviceId}
            </h2>
          </div>
        </CardContent>
      </Card>
      <DataView
        state={state}
        items={[]}
        errorRequestId={requestId}
        onRetry={() => {
          setState("loading");
          setReload((n) => n + 1);
        }}
        renderReady={() => null}
      />
      {state === "ready" && device ? (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          className="min-w-0 gap-6"
        >
          <div className="overflow-x-auto pb-1">
            <TabsList
              aria-label="Bagian detail"
              className="w-max min-w-full justify-start border bg-card p-1"
            >
              {TABS.map((t) => (
                <TabsTrigger
                  value={t}
                  key={t}
                  className="px-4 data-[state=active]:bg-accent data-[state=active]:text-primary"
                >
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {TABS.map((t) => (
            <TabsContent value={t} key={t}>
              {fields[t] ? (
                <Card>
                  <CardContent>
                    <dl className="detail-grid">
                      {fields[t].map(([label, path]) => (
                        <div key={path}>
                          <dt>{label}</dt>
                          <dd>
                            {path === "Events.Inform" && lastInform
                              ? Number.isFinite(Number(lastInform))
                                ? new Date(Number(lastInform)).toLocaleString(
                                    "id-ID",
                                  )
                                : lastInform
                              : val(device, path) || "Belum tersedia"}
                          </dd>
                        </div>
                      ))}
                      {t === "WiFi" ? (
                        <div>
                          <dt>PreSharedKey</dt>
                          <dd className="font-mono text-sm">[REDACTED]</dd>
                        </div>
                      ) : null}
                    </dl>
                  </CardContent>
                </Card>
              ) : null}
              {t === "Parameter" ? <ParameterBrowser device={device} /> : null}
              {t === "Diagnosis" ? <Diagnostics deviceId={deviceId} /> : null}
              {t === "Ringkasan" ? (
                <Card>
                  <CardContent className="space-y-3">
                    <h3 className="text-sm font-semibold">Aksi perangkat</h3>
                    {session.phase === "authenticated" ? (
                      <DeviceActions deviceId={deviceId} />
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
              {t === "WAN" ? (
                <WanEditor
                  deviceId={deviceId}
                  collection={wanCollection}
                  instance={wanInstance}
                />
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
      ) : null}
      {state === "empty" ? (
        <Status tone="warning">Perangkat tidak ditemukan.</Status>
      ) : null}
    </div>
  );
}
