"use client";

// Config UI component renderers (M06-A): every type the native custom
// configuration uses, mapped onto the M03/M04 component system.
// Anchors accept ONLY relative/http/https targets with rel=noopener;
// style/class attributes pass through a small allowlist; unknown
// config is NEVER dropped (see registry.tsx).
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import {
  evaluateToText,
  evaluateUiExpression,
  type UiExpression,
} from "./expression";
import { map } from "../../../../../lib/common/expression/parser.ts";
import { componentList } from "./config-tree";
import {
  SAFE_HREF,
  configChildKey,
  type ConfigNode,
  type RenderContext,
} from "./config-node";

// The `parameter` field arrives from the native config walk as an
// EVALUATED expression AST (arrays); hand-written configs may still use
// a literal path string. Both go through the shared native evaluator —
// String() on an AST produced "PARAM,DeviceID.ID" garbage (PR #8
// review).
function parameterExpression(value: unknown): UiExpression | null {
  if (Array.isArray(value)) return value as never;
  if (typeof value === "string" && value) return ["PARAM", value] as never;
  return null;
}

// Labels are stored as literals; only unresolved expressions (NOW()-,
// device-parameter-based) stay ASTs.
function labelText(value: unknown, ctx: RenderContext): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value))
    return evaluateToText(value as never, ctx.device, ctx.now);
  return "";
}

function nodeText(node: ConfigNode, ctx: RenderContext): string {
  const param = parameterExpression(node.parameter);
  if (param != null) return evaluateToText(param, ctx.device, ctx.now);
  if (node.expression != null)
    return evaluateToText(node.expression as never, ctx.device, ctx.now);
  return labelText(node.label, ctx);
}

export function ParameterView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): ReactNode {
  const text = nodeText(node, ctx);
  const label = labelText(node.label, ctx);
  return (
    <div className="min-w-0">
      {label ? <p className="text-xs text-muted-foreground">{label}</p> : null}
      <p className="break-all font-mono text-sm">{text}</p>
    </div>
  );
}

export function ParameterListView({
  node,
  ctx,
  renderChild,
}: {
  node: ConfigNode;
  ctx: RenderContext;
  renderChild: (child: ConfigNode, ctx: RenderContext) => ReactNode;
}): ReactNode {
  // Native parameter-list children live in a KEYED `parameters` map
  // ({label, parameter, type?}); legacy configs may carry `list` or
  // `components`. Each child dispatches through the registry by its own
  // type — upstream m.context dispatch with "parameter" as the default.
  const children = componentList(
    node.parameters ?? node.list ?? node.components,
  );
  return (
    <div className="space-y-2">
      {node.label ? (
        <p className="text-sm font-semibold">{labelText(node.label, ctx)}</p>
      ) : null}
      <ul className="space-y-1">
        {children.map((child, i) => (
          <li key={configChildKey(child, i)} className="text-sm">
            {renderChild({ ...child, type: child.type ?? "parameter" }, ctx)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Distinct instance paths under a collection object on the flat device
// — the same enumeration upstream parameter-table performs.
function instancePaths(device: RenderContext["device"], object: string) {
  const prefix = `${object}.`;
  const instances = new Set<string>();
  for (const key of Object.keys(device)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const dot = rest.indexOf(".");
    instances.add(dot === -1 ? key : `${key.slice(0, prefix.length + dot)}`);
  }
  return [...instances].sort();
}

// Rewrite a child parameter expression onto one instance: every PARAM
// leaf gains the instance prefix (upstream maps to ["||", i, ".", …]).
function instanceParameter(value: unknown, instance: string): unknown {
  if (typeof value === "string") return `${instance}.${value}`;
  if (Array.isArray(value))
    return map(value as never, (e) => {
      if (Array.isArray(e) && e[0] === "PARAM")
        return ["PARAM", ["||", instance, ".", e[1]]] as never;
      return e;
    });
  return value;
}

// Native parameter-table renderer: `parameter` names the collection
// OBJECT and `childParameters` (keyed map of {label, parameter})
// describe the per-instance columns; the instances enumerate from the
// flat device (PR #8 review: the childParameters DTO never rendered).
function nativeParameterTableView(
  node: ConfigNode,
  ctx: RenderContext,
  renderChild: (child: ConfigNode, ctx: RenderContext) => ReactNode,
): ReactNode {
  const parameter = parameterExpression(node.parameter);
  // Object nodes have no scalar value: evaluate PARAM's path operand, as
  // upstream does, rather than looking up the collection's nonexistent value.
  const path =
    Array.isArray(parameter) && parameter[0] === "PARAM" ? parameter[1] : null;
  const object =
    typeof path === "string"
      ? path
      : evaluateUiExpression(path as never, ctx.device, ctx.now);
  const children = componentList(node.childParameters);
  if (typeof object !== "string" || !object || !children.length) return null;
  const instances = instancePaths(ctx.device, object).filter(
    (instance) =>
      node.filter == null ||
      Boolean(
        evaluateUiExpression(
          instanceParameter(node.filter, instance) as never,
          ctx.device,
          ctx.now,
        ),
      ),
  );
  return (
    <div className="overflow-hidden rounded-xl border">
      <table
        className="w-full text-sm"
        aria-label={labelText(node.label, ctx) || "Parameter"}
      >
        <thead>
          <tr className="border-b bg-accent/40">
            <th scope="col" className="p-2 text-left text-xs font-medium">
              Instance
            </th>
            {children.map((child, i) => (
              <th
                key={configChildKey(child, i)}
                scope="col"
                className="p-2 text-left text-xs font-medium"
              >
                {labelText(child.label, ctx) || `Kolom ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => (
            <tr key={instance} className="border-b last:border-b-0">
              <th
                scope="row"
                className="max-w-72 break-all p-2 text-left text-xs font-normal text-muted-foreground"
              >
                {instance}
              </th>
              {children.map((child, i) => (
                <td
                  key={configChildKey(child, i)}
                  className="break-all p-2 font-mono text-xs"
                >
                  {renderChild(
                    {
                      ...child,
                      type: child.type ?? "parameter",
                      label: null,
                      parameter: instanceParameter(
                        child.parameter,
                        instance,
                      ) as string,
                    },
                    ctx,
                  )}
                </td>
              ))}
            </tr>
          ))}
          {!instances.length ? (
            <tr>
              <td
                className="p-2 text-xs text-muted-foreground"
                colSpan={children.length + 1}
              >
                Tidak ada instance.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// Legacy hand-written shape: `parameters` lists literal paths.
function legacyParameterTableView(
  node: ConfigNode,
  ctx: RenderContext,
): ReactNode {
  const parameters = Array.isArray(node.parameters)
    ? (node.parameters as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : node.parameter
      ? [String(node.parameter)]
      : [];
  return (
    <div className="overflow-hidden rounded-xl border">
      <table
        className="w-full text-sm"
        aria-label={labelText(node.label, ctx) || "Parameter"}
      >
        <tbody>
          {parameters.map((p) => (
            <tr key={p} className="border-b last:border-b-0">
              <th
                scope="row"
                className="max-w-72 break-all p-2 text-left text-xs font-normal text-muted-foreground"
              >
                {p}
              </th>
              <td className="break-all p-2 font-mono text-xs">
                {evaluateToText(["PARAM", p] as never, ctx.device, ctx.now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ParameterTableView({
  node,
  ctx,
  renderChild,
}: {
  node: ConfigNode;
  ctx: RenderContext;
  renderChild: (child: ConfigNode, ctx: RenderContext) => ReactNode;
}): ReactNode {
  const native =
    node.childParameters != null
      ? nativeParameterTableView(node, ctx, renderChild)
      : null;
  if (native != null) return <>{native}</>;
  return <>{legacyParameterTableView(node, ctx)}</>;
}

export function ContainerView({
  node,
  ctx,
  renderChild,
}: {
  node: ConfigNode;
  ctx: RenderContext;
  renderChild: (child: ConfigNode, ctx: RenderContext) => ReactNode;
}): ReactNode {
  if (
    "filter" in node &&
    !evaluateUiExpression(node.filter as never, ctx.device, ctx.now)
  )
    return null;
  return (
    <Card>
      <CardContent className="space-y-3">
        {node.label ? (
          <h3 className="text-sm font-semibold">
            {labelText(node.label, ctx)}
          </h3>
        ) : null}
        {componentList(node.components).map((child, i) => (
          <div key={configChildKey(child, i)}>{renderChild(child, ctx)}</div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AnchorView({
  node,
  ctx,
  renderChild,
}: {
  node: ConfigNode;
  ctx: RenderContext;
  renderChild: (child: ConfigNode, ctx: RenderContext) => ReactNode;
}): ReactNode {
  const rawHref = String(
    node.href ??
      node.url ??
      evaluateUiExpression(node.expression as never, ctx.device, ctx.now) ??
      "",
  );
  // Only same-site/absolute http(s) targets render; everything else
  // (javascript:, data:, …) is dropped entirely.
  if (!rawHref || !SAFE_HREF.test(rawHref)) return null;
  const children = componentList(node.components).map((child, i) => (
    <span key={configChildKey(child, i)}>{renderChild(child, ctx)}</span>
  ));
  return (
    <a
      href={rawHref}
      rel="noopener noreferrer"
      target={rawHref.startsWith("/") ? undefined : "_blank"}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
    >
      {children.length ? children : (node.label ?? rawHref)}
    </a>
  );
}

// Chart-joined dot (native overview-dot): the first ui.overview slice
// whose filter matches the device renders with its color; no match or
// unknown chart renders nothing (upstream returns null).
function chartSliceDot(chartName: string, ctx: RenderContext): ReactNode {
  const chart = ctx.charts?.find(
    (c) => c.key === chartName || c.label === chartName,
  );
  if (!chart) return null;
  for (const slice of chart.slices) {
    if (
      slice.filter &&
      evaluateUiExpression(slice.filter, ctx.device, ctx.now)
    ) {
      return (
        <span className="inline-flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-full"
            style={
              slice.color
                ? { backgroundColor: slice.color }
                : { backgroundColor: "var(--success, #22c55e)" }
            }
          />
          {slice.label}
        </span>
      );
    }
  }
  return null;
}

export function OverviewDotView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): ReactNode {
  const chartName = labelText(node.chart, ctx);
  const joined = chartName ? chartSliceDot(chartName, ctx) : null;
  if (joined != null) return <>{joined}</>;
  const v = evaluateUiExpression(
    parameterExpression(node.parameter) ?? (node.expression as never),
    ctx.device,
    ctx.now,
  );
  const up = v === true || v === 1 || v === "1";
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`inline-block size-3 rounded-full ${up ? "bg-success" : "bg-destructive"}`}
      />
      {labelText(node.label, ctx)}
    </span>
  );
}

export function LongTextView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): ReactNode {
  return (
    <details className="rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">
        {labelText(node.label, ctx) || "Teks panjang"}
      </summary>
      <p className="mt-2 whitespace-pre-wrap break-all font-mono text-xs">
        {nodeText(node, ctx)}
      </p>
    </details>
  );
}

export function DeviceLinkView({
  node,
  ctx,
  renderChild,
}: {
  node: ConfigNode;
  ctx: RenderContext;
  renderChild: (child: ConfigNode, ctx: RenderContext) => ReactNode;
}): ReactNode {
  // deviceId may be an expression AST in the native DTO; a plain string
  // (hand-written) is used verbatim.
  const deviceId =
    typeof node.deviceId === "string"
      ? node.deviceId
      : String(
          evaluateUiExpression(
            (node.deviceId ?? ["PARAM", "DeviceID.ID"]) as never,
            ctx.device,
            ctx.now,
          ) ?? "",
        );
  if (!deviceId) return null;
  return (
    <a
      href={`/devices/${encodeURIComponent(deviceId)}`}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
    >
      {componentList(node.components).map((child, i) => (
        <span key={configChildKey(child, i)}>{renderChild(child, ctx)}</span>
      )) ||
        labelText(node.label, ctx) ||
        deviceId}
    </a>
  );
}

export function LoadingView({ label }: { label?: string }): ReactNode {
  return <Status tone="muted">{label ?? "Memuat…"}</Status>;
}
