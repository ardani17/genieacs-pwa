"use client";

// ConfigRenderer (M06-A): renders a native custom-config tree. The
// ORIGINAL configuration object is never mutated — unknown nodes and
// unknown keys survive a serialize → edit → save → load round-trip
// byte-for-byte (see normalizeConfigTree in config-tree.ts).
import type { ReactNode } from "react";
import { renderConfigNode } from "./registry";
import type { ConfigNode, RenderContext } from "./config-node";

export function ConfigRenderer({
  node,
  context,
}: {
  node: ConfigNode;
  context: RenderContext;
}): ReactNode {
  return <>{renderConfigNode(node, context)}</>;
}
