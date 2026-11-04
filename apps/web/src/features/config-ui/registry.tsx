"use client";

// Registry (M06-A): every native custom-config type mapped to a React
// renderer. Unknown types render a diagnostic placeholder that KEEPS
// the configuration visible — data is never silently deleted — and
// emits one safe diagnostic event per type.
import type { ReactNode } from "react";
import { Status } from "@/components/ui/status";
import {
  AnchorView,
  ContainerView,
  DeviceLinkView,
  LoadingView,
  LongTextView,
  OverviewDotView,
  ParameterListView,
  ParameterTableView,
  ParameterView,
  type ConfigNode,
  type RenderContext,
} from "./components";

export const REGISTRY_TYPES = [
  "parameter",
  "parameter-list",
  "parameter-table",
  "container",
  "summon-button",
  "tags",
  "overview-dot",
  "ping",
  "device-link",
  "a",
  "device-faults",
  "device-actions",
  "all-parameters",
  "long-text",
  "loading",
] as const;

const reportedUnknown = new Set<string>();

function unknownPlaceholder(node: ConfigNode, path: string): ReactNode {
  if (!reportedUnknown.has(node.type)) {
    reportedUnknown.add(node.type);
    // One safe diagnostic event per unknown type: the config path and
    // type name only — never the node payload.
    console.warn(`[config-ui] komponen belum didukung: ${node.type} (${path})`);
  }
  return (
    <Status tone="warning">
      Komponen belum didukung ({node.type}) — konfigurasi asli dipertahankan.
    </Status>
  );
}

// Interactive types (summon/ping/faults/actions/tags/all-parameters)
// render as labeled rows: their behavior belongs to the device page,
// never to strings inside configuration.
function interactiveStub(label: string): ReactNode {
  return (
    <span className="text-xs text-muted-foreground">
      {label} — aksi tersedia pada halaman perangkat.
    </span>
  );
}

export function renderConfigNode(
  node: ConfigNode,
  ctx: RenderContext,
  path = "$",
): ReactNode {
  if (!node || typeof node !== "object") return null;
  const childPath = `${path}.${node.type}`;
  switch (node.type) {
    case "parameter":
      return <ParameterView node={node} ctx={ctx} />;
    case "parameter-list":
      return <ParameterListView node={node} ctx={ctx} />;
    case "parameter-table":
      return <ParameterTableView node={node} ctx={ctx} />;
    case "container":
      return (
        <ContainerView
          node={node}
          ctx={ctx}
          renderChild={(child, c) => renderConfigNode(child, c, childPath)}
        />
      );
    case "a":
    case "anchor":
      return (
        <AnchorView
          node={node}
          ctx={ctx}
          renderChild={(child, c) => renderConfigNode(child, c, childPath)}
        />
      );
    case "overview-dot":
      return <OverviewDotView node={node} ctx={ctx} />;
    case "long-text":
      return <LongTextView node={node} ctx={ctx} />;
    case "device-link":
      return (
        <DeviceLinkView
          node={node}
          ctx={ctx}
          renderChild={(child, c) => renderConfigNode(child, c, childPath)}
        />
      );
    case "loading":
      return <LoadingView label={node.label} />;
    case "summon-button":
    case "tags":
    case "ping":
    case "device-faults":
    case "device-actions":
    case "all-parameters":
      return interactiveStub(node.label ?? node.type);
    default:
      return unknownPlaceholder(node, childPath);
  }
}
