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

// Normalize a NATIVE components map into the ordered array the
// renderers iterate. The engine's local-cache walk materializes flat
// `ui.*` rows into NUMERIC-KEYED objects ({"0": …, "7": …}) — integer
// keys iterate ascending, which is exactly upstream's Object.values
// order. Arrays (hand-written configs) pass through filtered (PR #8
// review: keyed objects used to crash .map or vanish entirely).
export function componentList(value: unknown): ConfigNode[] {
  if (Array.isArray(value))
    return value.filter((v): v is ConfigNode => isConfigNode(v));
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).filter(
      (v): v is ConfigNode => isConfigNode(v),
    );
  return [];
}

function isConfigNode(v: unknown): v is ConfigNode {
  // Native child entries may omit `type` (upstream defaults them to
  // "parameter"); anything object-shaped survives so unknown config is
  // never dropped.
  return !!v && typeof v === "object" && !Array.isArray(v);
}
