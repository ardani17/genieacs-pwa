"use client";

// Config UI component renderers (M06-A): every type the native custom
// configuration uses, mapped onto the M03/M04 component system.
// Anchors accept ONLY relative/http/https targets with rel=noopener;
// style/class attributes pass through a small allowlist; unknown
// config is NEVER dropped (see registry.tsx).
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { evaluateToText, evaluateUiExpression } from "./expression";
import {
  SAFE_HREF,
  configChildKey,
  type ConfigNode,
  type RenderContext,
} from "./config-node";

function nodeText(node: ConfigNode, ctx: RenderContext): string {
  if (node.parameter != null)
    return evaluateToText(
      ["PARAM", String(node.parameter)] as never,
      ctx.device,
      ctx.now,
    );
  if (node.expression != null)
    return evaluateToText(node.expression as never, ctx.device, ctx.now);
  return node.label ?? "";
}

export function ParameterView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): ReactNode {
  const text = nodeText(node, ctx);
  return (
    <div className="min-w-0">
      {node.label ? (
        <p className="text-xs text-muted-foreground">{node.label}</p>
      ) : null}
      <p className="break-all font-mono text-sm">{text}</p>
    </div>
  );
}

export function ParameterListView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): ReactNode {
  const list = Array.isArray(node.list)
    ? (node.list as ConfigNode[])
    : (node.components ?? []);
  return (
    <div className="space-y-2">
      {node.label ? (
        <p className="text-sm font-semibold">{node.label}</p>
      ) : null}
      <ul className="space-y-1">
        {list.map((child, i) => (
          <li key={configChildKey(child, i)} className="text-sm">
            {nodeText(child, ctx)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ParameterTableView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): ReactNode {
  const parameters = Array.isArray(node.parameters)
    ? (node.parameters as string[])
    : node.parameter
      ? [String(node.parameter)]
      : [];
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm" aria-label={node.label ?? "Parameter"}>
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

export function ContainerView({
  node,
  ctx,
  renderChild,
}: {
  node: ConfigNode;
  ctx: RenderContext;
  renderChild: (child: ConfigNode, ctx: RenderContext) => ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardContent className="space-y-3">
        {node.label ? (
          <h3 className="text-sm font-semibold">{node.label}</h3>
        ) : null}
        {(node.components ?? []).map((child, i) => (
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
  const children = (node.components ?? []).map((child, i) => (
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

export function OverviewDotView({
  node,
  ctx,
}: {
  node: ConfigNode;
  ctx: RenderContext;
}): ReactNode {
  const v = evaluateUiExpression(node.expression as never, ctx.device, ctx.now);
  const up = v === true || v === 1 || v === "1";
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`inline-block size-3 rounded-full ${up ? "bg-success" : "bg-destructive"}`}
      />
      {node.label ?? ""}
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
        {node.label ?? "Teks panjang"}
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
  const deviceId = String(
    node.deviceId ??
      evaluateUiExpression(
        ["PARAM", "DeviceID.ID"] as never,
        ctx.device,
        ctx.now,
      ) ??
      "",
  );
  if (!deviceId) return null;
  return (
    <a
      href={`/devices/${encodeURIComponent(deviceId)}`}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
    >
      {(node.components ?? []).map((child, i) => (
        <span key={configChildKey(child, i)}>{renderChild(child, ctx)}</span>
      )) ||
        node.label ||
        deviceId}
    </a>
  );
}

export function LoadingView({ label }: { label?: string }): ReactNode {
  return <Status tone="muted">{label ?? "Memuat…"}</Status>;
}
