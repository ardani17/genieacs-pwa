// Config tree helpers (split from renderer.tsx so the component file
// exports components only).
import type { ConfigNode } from "./config-node";

// Deep copy that preserves unknown keys verbatim; structuredClone is
// safe because config values are JSON data by construction.
export function normalizeConfigTree(node: unknown): unknown {
  return structuredClone(node ?? null);
}

// Config-path helper for diagnostics.
export function configPathOf(node: ConfigNode, parent = "$"): string {
  return `${parent}.${node.type ?? "?"}`;
}
