"use client";

// Device detail: contract tabs (Ringkasan/WAN/WiFi/Parameter/Diagnosis).
// Unavailable values show "Belum tersedia"; parameter timestamps are
// visible; read pages never send tasks automatically.
import { useEffect, useState } from "react";
import { DataView } from "@/components/ui/data-view";
import { Status } from "@/components/ui/status";
import { ParameterBrowser } from "./parameter-browser";
import { Diagnostics } from "./diagnostics";
import type { ApiResult } from "@contracts/api.ts";

type FlatDevice = Record<string, { value?: [unknown, string] } | unknown>;

const TABS = ["Ringkasan", "WAN", "WiFi", "Parameter", "Diagnosis"] as const;
type Tab = (typeof TABS)[number];

function val(device: FlatDevice | null, path: string): string {
  const entry = device?.[path] as { value?: [unknown, string] } | undefined;
  return entry?.value ? String(entry.value[0]) : "";
}

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const [tab, setTab] = useState<Tab>("Ringkasan");
  const [state, setState] = useState<"loading" | "ready" | "error" | "empty">(
    "loading",
  );
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
        if (body.ok !== true) {
          setRequestId(body.requestId);
          setState(
            body.ok === false && body.error.code === "NOT_FOUND"
              ? "empty"
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
  }, [deviceId]);

  const lastInform = val(device, "Events.Inform");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <h2 style={{ wordBreak: "break-all" }}>{deviceId}</h2>
      <div
        role="tablist"
        aria-label="Bagian detail"
        style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              minHeight: "var(--touch-target)",
              padding: "var(--space-8) var(--space-12)",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              background:
                tab === t ? "var(--color-primary)" : "var(--color-surface)",
              color:
                tab === t
                  ? "var(--color-primary-contrast)"
                  : "var(--color-primary)",
              font: "inherit",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <DataView
        state={state}
        items={[]}
        errorRequestId={requestId}
        onRetry={() => setState("loading")}
        renderReady={() => null}
      />
      {state === "ready" && device ? (
        <div role="tabpanel" aria-label={tab}>
          {tab === "Ringkasan" ? (
            <dl style={{ display: "grid", gap: "var(--space-8)" }}>
              <div>
                <dt>Model</dt>
                <dd>
                  {val(device, "DeviceID.ProductClass") || "Belum tersedia"}
                </dd>
              </div>
              <div>
                <dt>Firmware</dt>
                <dd>
                  {val(
                    device,
                    "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
                  ) || "Belum tersedia"}
                </dd>
              </div>
              <div>
                <dt>Serial</dt>
                <dd>
                  {val(device, "DeviceID.SerialNumber") || "Belum tersedia"}
                </dd>
              </div>
              <div>
                <dt>Terakhir inform</dt>
                <dd>{lastInform || "Belum tersedia"}</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>
                  {val(device, "InternetGatewayDevice.DeviceInfo.UpTime") ||
                    "Belum tersedia"}
                </dd>
              </div>
            </dl>
          ) : null}
          {tab === "WAN" ? (
            <dl style={{ display: "grid", gap: "var(--space-8)" }}>
              <div>
                <dt>IP eksternal</dt>
                <dd>
                  {val(
                    device,
                    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
                  ) || "Belum tersedia"}
                </dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>
                  {val(
                    device,
                    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionType",
                  ) || "Belum tersedia"}
                </dd>
              </div>
            </dl>
          ) : null}
          {tab === "WiFi" ? (
            <dl style={{ display: "grid", gap: "var(--space-8)" }}>
              <div>
                <dt>SSID</dt>
                <dd>
                  {val(
                    device,
                    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
                  ) || "Belum tersedia"}
                </dd>
              </div>
              <div>
                <dt>PreSharedKey</dt>
                <dd>[REDACTED]</dd>
              </div>
            </dl>
          ) : null}
          {tab === "Parameter" ? <ParameterBrowser device={device} /> : null}
          {tab === "Diagnosis" ? <Diagnostics deviceId={deviceId} /> : null}
        </div>
      ) : null}
      {state === "empty" ? (
        <Status tone="warning">Perangkat tidak ditemukan.</Status>
      ) : null}
    </div>
  );
}
