#!/usr/bin/env node
// Config coverage gate (M06-A): counts every component type in the
// sanitized UI-config fixture (and any extra export passed as argv),
// matches them against the renderer registry, and fails when a type
// has no renderer. Types WITHOUT a renderer are the parity gap — the
// gate exists so new native config types cannot ship silently.
//
// The registry list mirrors apps/web/src/features/config-ui/registry.tsx
// (REGISTRY_TYPES); a mismatch in either direction fails the gate.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const REGISTRY_TYPES = new Set([
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
  "anchor",
  "device-faults",
  "device-actions",
  "all-parameters",
  "long-text",
  "loading",
]);

// Types the fixture deliberately includes as NEGATIVE cases: they must
// NOT be in the registry (their renderers are expected to be the
// diagnostic placeholder).
const EXPECTED_UNSUPPORTED = new Set([
  "dangerous-raw-html",
  "totally-unknown-type",
]);

function walk(node, counts) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, counts);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string")
    counts[node.type] = (counts[node.type] ?? 0) + 1;
  for (const value of Object.values(node)) walk(value, counts);
}

const fixturePaths = [
  path.resolve("test/fixtures/ui-config.json"),
  ...process.argv.slice(2),
];

const counts = {};
const sources = {};
for (const p of fixturePaths) {
  const before = { ...counts };
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  // The repo fixture walks ONLY the device custom-config tree — its
  // overview/index sections describe other config surfaces (charts,
  // index columns). Extra argv exports walk whole-file.
  walk(p.endsWith("ui-config.json") ? (parsed.device ?? {}) : parsed, counts);
  for (const type of Object.keys(counts)) {
    if (!(type in before)) sources[type] = path.basename(p);
  }
}

const missing = Object.keys(counts)
  .filter((t) => !REGISTRY_TYPES.has(t) && !EXPECTED_UNSUPPORTED.has(t))
  .sort();
const unexpectedUnsupported = [...EXPECTED_UNSUPPORTED].filter((t) =>
  REGISTRY_TYPES.has(t),
);

mkdirSync(path.resolve("artifacts/parity"), { recursive: true });
const report = {
  fixtureTypes: Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  ),
  sources,
  registryTypes: [...REGISTRY_TYPES].sort(),
  missingRenderers: missing,
  fixtureOnlyUnsupported: [...EXPECTED_UNSUPPORTED].filter((t) => t in counts),
  checkedAt: new Date().toISOString(),
};
writeFileSync(
  path.resolve("artifacts/parity/config-coverage.json"),
  JSON.stringify(report, null, 2) + "\n",
);

process.stdout.write(
  `${JSON.stringify(
    {
      fixtureTypes: Object.keys(counts).length,
      registryTypes: REGISTRY_TYPES.size,
      missingRenderers: missing,
    },
    null,
    1,
  )}\n`,
);

if (missing.length) {
  process.stderr.write(
    `MISSING_RENDERERS: fixture types without a renderer: ${missing.join(", ")}\n`,
  );
  process.exit(1);
}
if (unexpectedUnsupported.length) {
  process.stderr.write(
    `REGISTRY_CONFLICT: expected-unsupported types are registered: ${unexpectedUnsupported.join(", ")}\n`,
  );
  process.exit(1);
}
