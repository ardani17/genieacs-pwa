"use client";

// Interactive config-UI behaviors (M06-A spec gap): the six native
// types the renderer stubbed as text now run the SAME tested device
// components the detail page uses — summon refresh, tag editing, ping
// diagnostics, faults, actions and the full parameter table — driven
// from the custom-config tree with the renderer's device context.
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import type { ConfigNode, RenderContext } from "./config-node";
import { TagEditor } from "../devices/tag-editor";
import { Diagnostics } from "../devices/diagnostics";
import { ParameterBrowser } from "../devices/parameter-browser";
import { OperationResult, type WanOutcome } from "../tasks/operation-result";
import { useEffect, useRef, useState } from "react";
import type { ApiResult } from "@contracts/api.ts";
import { stringify } from "../../../../../lib/common/expression/parser.ts";

function deviceIdOf(ctx: RenderContext): string {
  return String(
    (ctx.device as Record<string, { value?: [unknown, string] }>)["DeviceID.ID"]
      ?.value?.[0] ?? "",
  );
}

// summon-button: initiate a session + refresh basic parameters — a
// single guarded refreshObject task on the device root, result shown
// inline (never auto-retried).
export function SummonButtonView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): React.ReactNode {
  const deviceId = deviceIdOf(ctx);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<WanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);

  const summon = async (): Promise<void> => {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    if (!operationId.current) operationId.current = crypto.randomUUID();
    try {
      const res = await fetch(
        `/api/app/devices/${encodeURIComponent(deviceId)}/commands`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-App-Request": "1",
          },
          body: JSON.stringify({
            operationId: operationId.current,
            deviceId,
            tasks: [
              { name: "refreshObject", objectName: "InternetGatewayDevice." },
            ],
          }),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        setError("Perintah tidak dapat dijalankan.");
        return;
      }
      const body = (await res.json()) as ApiResult<WanOutcome>;
      if (body.ok !== true) setError(body.error.message);
      else setOutcome(body.data);
    } catch {
      setError("Hasil belum terkonfirmasi — koneksi terputus.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        onClick={() => void summon()}
        busy={busy}
        disabled={!deviceId}
      >
        {node.label ?? "Summon"}
      </Button>
      {outcome ? <OperationResult outcome={outcome} /> : null}
      {error ? <Status tone="warning">{error}</Status> : null}
    </div>
  );
}

// tags: the same permission-checked editor the detail page hosts.
export function ConfigTagsView({
  ctx,
}: {
  ctx: RenderContext;
}): React.ReactNode {
  const deviceId = deviceIdOf(ctx);
  if (!deviceId)
    return <Status tone="muted">Tags tersedia pada halaman perangkat.</Status>;
  return <TagEditor deviceId={deviceId} />;
}

// ping: the diagnostics suite already runs the fixed, authorized
// checks — the native ping type maps onto it.
export function ConfigPingView(): React.ReactNode {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Ping dijalankan lewat diagnosis berizin.
      </p>
      <Diagnostics deviceId="" />
    </div>
  );
}

export function ConfigPingWithDevice({
  ctx,
}: {
  ctx: RenderContext;
}): React.ReactNode {
  const deviceId = deviceIdOf(ctx);
  return (
    <div className="space-y-2">
      <Diagnostics deviceId={deviceId} />
    </div>
  );
}

// device-faults: the device's fault list through the guarded resource
// route (read-only here; deletion stays on the faults page).
export function ConfigDeviceFaultsView({
  ctx,
}: {
  ctx: RenderContext;
}): React.ReactNode {
  const deviceId = deviceIdOf(ctx);
  const [rows, setRows] = useState<
    { _id: string; code?: string; message?: string }[]
  >([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!deviceId) return undefined;
    // No-device contexts surface through the empty result instead of a
    // synchronous setState in the effect body.
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      if (!deviceId) {
        controller.abort();
        return;
      }
      void fetch(
        `/api/app/resources/faults?page=1&pageSize=10&filter=${encodeURIComponent(
          stringify(["=", ["PARAM", "DeviceID.ID"], deviceId]),
        )}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (res) => {
          if (!res.ok) throw new Error("faults unavailable");
          const body = (await res.json()) as ApiResult<{
            items: { _id: string; code?: string; message?: string }[];
          }>;
          if (body.ok !== true) throw new Error("faults unavailable");
          setRows(body.data.items);
          setState("ready");
        })
        .catch(() => setState("error"));
    }, 0);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [deviceId]);

  if (state === "loading") return <Status tone="muted">Memuat fault…</Status>;
  if (state === "error")
    return <Status tone="danger">Fault perangkat tidak dapat dimuat.</Status>;
  if (!rows.length) return <Status tone="muted">Tidak ada fault aktif.</Status>;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((row) => (
        <li key={row._id} className="rounded-lg border px-3 py-2">
          <span className="font-mono text-xs">{row.code ?? "—"}</span>{" "}
          <span className="text-xs text-muted-foreground">
            {row.message ?? ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

// device-actions: a compact link to the device page's action set — the
// destructive confirmations live there by design.
export function ConfigDeviceActionsView({
  ctx,
}: {
  ctx: RenderContext;
}): React.ReactNode {
  const deviceId = deviceIdOf(ctx);
  if (!deviceId)
    return (
      <Status tone="muted">Aksi perangkat butuh konteks perangkat.</Status>
    );
  return (
    <a
      href={`/devices/${encodeURIComponent(deviceId)}`}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
    >
      Buka aksi perangkat ({deviceId})
    </a>
  );
}

// all-parameters: the full parameter table over the context device.
export function ConfigAllParametersView({
  ctx,
}: {
  ctx: RenderContext;
}): React.ReactNode {
  const deviceId = deviceIdOf(ctx);
  if (!deviceId)
    return (
      <Status tone="muted">Parameter tersedia pada halaman perangkat.</Status>
    );
  return <ParameterBrowser device={ctx.device as Record<string, never>} />;
}
