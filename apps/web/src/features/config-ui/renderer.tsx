"use client";

// ConfigRenderer (M06-A): renders a native custom-config tree. The
// ORIGINAL configuration object is never mutated — unknown nodes and
// unknown keys survive a serialize → edit → save → load round-trip
// byte-for-byte (see normalizeConfigTree).
import type { ReactNode } from "react";
import { renderConfigNode } from "./registry";
import type { ConfigNode, RenderContext } from "./components";

export function ConfigRenderer({
  node,
  context,
}: {
  node: ConfigNode;
  context: RenderContext;
}): ReactNode {
  return <>{renderConfigNode(node, context)}</>;
}

// Deep copy that preserves unknown keys verbatim; JSON-stable because
// config values are JSON data by construction.
export function normalizeConfigTree(node: unknown): unknown {
  return JSON.parse(JSON.stringify(node ?? null));
}

// Config-path helper for diagnostics.
export function configPathOf(node: ConfigNode, parent = "$"): string {
  return `${parent}.${node.type ?? "?"}`;
}

export type { ConfigNode, RenderContext } from "./components";
