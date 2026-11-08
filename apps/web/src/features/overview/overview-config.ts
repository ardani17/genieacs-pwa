// Overview configuration normalizer (RE-SPEC-08): the NATIVE ui.overview
// shape that reaches the browser through the SessionDTO is produced by
// the engine's local-cache walk over flat dotted config rows — charts
// groups carry NUMERIC-KEYED objects ({"0": "online"}), and slice
// filters arrive as EVALUATED expression ASTs (arrays), not strings.
// Upstream renders these with Object.values (ui/overview-page.ts); this
// module applies the same normalization so the page never iterates a
// non-iterable and never drops an AST filter. The SessionDTO stays a
// verbatim passthrough — normalization belongs to the consumer.
import { stringify } from "../../../../../lib/common/expression/parser.ts";
import { evaluate } from "../../../../../lib/common/expression/util.ts";
import type { Expression } from "@contracts/api.ts";

export interface OverviewSlice {
  key: string;
  label: string;
  filter: string | null;
  color: string | null;
  count: number | null;
}

export interface OverviewChart {
  key: string;
  label: string;
  slices: OverviewSlice[];
}

type UnknownRecord = Record<string, unknown>;

function isAst(value: unknown): value is Expression {
  return Array.isArray(value);
}

// Labels are usually plain strings; an expression label is evaluated
// with the shared native evaluator (NOW() resolves) and falls back to
// the chart/slice key when the result is not presentable.
function labelFor(value: unknown, fallback: string): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isAst(value)) {
    try {
      const evaluated = evaluate(value, undefined, Date.now());
      if (typeof evaluated === "string" && evaluated) return evaluated;
      if (typeof evaluated === "number" && Number.isFinite(evaluated))
        return String(evaluated);
    } catch {
      // fall through to the key
    }
  }
  return fallback;
}

// Filters are stored as expression strings in the seeded config, but
// the local-cache walk EVALUATES rows before materializing them, so a
// filter containing NOW() arrives as its AST — stringified back with
// the native serializer for the count/list contract. Unstringifiable
// shapes become null (slice renders without a count), never a guess.
function filterFor(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (isAst(value)) {
    try {
      const text = stringify(value);
      if (text) return text;
    } catch {
      // fall through
    }
  }
  return null;
}

export function readOverviewConfig(
  uiConfig: UnknownRecord | undefined,
): OverviewChart[] {
  const overview = uiConfig?.["overview"] as UnknownRecord | undefined;
  if (!overview || typeof overview !== "object") return [];

  const charts: Record<string, OverviewChart> = {};
  for (const [chartId, chart] of Object.entries(
    (overview.charts as UnknownRecord) ?? {},
  )) {
    const chartRecord = (chart ?? {}) as UnknownRecord;
    const slices: OverviewSlice[] = Object.entries(
      (chartRecord.slices as UnknownRecord) ?? {},
    ).map(([sliceId, slice]) => {
      const sliceRecord = (slice ?? {}) as UnknownRecord;
      return {
        key: sliceId,
        label: labelFor(sliceRecord.label, sliceId),
        filter: filterFor(sliceRecord.filter),
        // Dot colors are literals in the seeded config; expressions
        // stay ASTs and degrade to null (a default color renders).
        color: filterFor(sliceRecord.color),
        count: null,
      };
    });
    charts[chartId] = {
      key: chartId,
      label: labelFor(chartRecord.label, chartId),
      slices,
    };
  }

  // Groups order the charts (native numeric-keyed objects iterate in
  // ascending key order — same as upstream's Object.values);
  // ungrouped charts follow after.
  const ordered: OverviewChart[] = [];
  const seen = new Set<string>();
  for (const group of Object.values((overview.groups as UnknownRecord) ?? {})) {
    const groupRecord = (group ?? {}) as UnknownRecord;
    const chartIds = Array.isArray(groupRecord.charts)
      ? groupRecord.charts
      : Object.values((groupRecord.charts as UnknownRecord) ?? {});
    for (const chartId of chartIds) {
      if (
        typeof chartId === "string" &&
        charts[chartId] &&
        !seen.has(chartId)
      ) {
        ordered.push(charts[chartId]);
        seen.add(chartId);
      }
    }
  }
  for (const [chartId, chart] of Object.entries(charts))
    if (!seen.has(chartId)) ordered.push(chart);
  return ordered;
}
