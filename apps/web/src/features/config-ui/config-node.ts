// Config node model (split from components.tsx so the component file
// exports components only): the config tree types plus the shared
// href/style safety helpers used by the renderers (M06-A).
import type { CSSProperties } from "react";
import type { FlatDeviceLike } from "../../../../../packages/device-profiles/src/types.ts";

export interface RenderContext {
  device: FlatDeviceLike;
  now: number;
  // Overview charts (native ui.overview) for chart-joined components
  // like overview-dot; optional so pure tests can omit it.
  charts?: {
    key: string;
    label: string;
    slices: {
      key: string;
      label: string;
      filter: string | null;
      color: string | null;
    }[];
  }[];
}

export interface ConfigNode {
  type: string;
  label?: string;
  parameter?: string;
  expression?: unknown;
  components?: ConfigNode[];
  href?: unknown;
  url?: unknown;
  deviceId?: unknown;
  chartType?: string;
  /** Unknown keys survive untouched — the renderer never rewrites config. */
  [key: string]: unknown;
}

export const SAFE_HREF = /^(https?:\/\/|\/)/i;
export const STYLE_PROP = /^(a-zA-Z-)+$/;
const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "font-weight",
  "text-align",
  "width",
  "flex-direction",
  "gap",
  "display",
]);

export function safeStyle(style: unknown): CSSProperties | undefined {
  if (!style || typeof style !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
    if (ALLOWED_STYLE_PROPS.has(k) && typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length ? (out as CSSProperties) : undefined;
}

// Stable React keys for config children: derived from the node content
// (type + identifying fields), with the position as a uniqueness
// suffix so repeated identical siblings never collide.
export function configChildKey(child: ConfigNode, index: number): string {
  const identity = String(
    child.parameter ?? child.label ?? child.href ?? child.url ?? "",
  );
  return `${child.type}-${identity}-${index}`;
}
