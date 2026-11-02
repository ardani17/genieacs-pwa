// RE-SPEC-08: the normalizer must consume the GENUINE native shape, not
// a synthetic one. The fixture below is the ui.overview seed from
// lib/init.ts:377-421 walked exactly the way lib/ui/local-cache.ts:75-92
// materializes flat dotted rows (that walk is pinned end-to-end by
// test/integration/overview-config.ts) — expression values pre-evaluated
// (NOW() filters stay AST arrays), trailing numeric segments become
// numeric-keyed objects.
import { describe, expect, it } from "vitest";
import { parse } from "../../../../../lib/common/expression/parser.ts";
import { evaluate } from "../../../../../lib/common/expression/util.ts";
import { readOverviewConfig } from "./overview-config";

// Mirrors lib/ui/local-cache.ts fetchConfig: evaluate each row value,
// then materialize dotted keys into nested objects.
function walkNative(rows: Record<string, string>): Record<string, unknown> {
  const ui: Record<string, unknown> = { overview: {} };
  for (const [id, rawValue] of Object.entries(rows).sort(([a], [b]) =>
    a > b ? 1 : -1,
  )) {
    const val = evaluate(parse(rawValue));
    const keys = id.split(".");
    keys.shift(); // drop "ui"
    let ref = ui as Record<string, unknown>;
    while (keys.length > 1) {
      const k = keys.shift() as string;
      const existing = ref[k];
      if (existing == null || typeof existing !== "object")
        ref[k] = {} as Record<string, unknown>;
      ref = ref[k] as Record<string, unknown>;
    }
    ref[keys[0]] = val;
  }
  return ui;
}

// The seed rows verbatim from lib/init.ts (options.overview).
const SEED_ROWS = {
  "ui.overview.charts.online.label": "'Online status'",
  "ui.overview.charts.online.slices.1_onlineNow.color": "'#31a354'",
  "ui.overview.charts.online.slices.1_onlineNow.filter":
    "Events.Inform > NOW() - 5 * 60 * 1000",
  "ui.overview.charts.online.slices.1_onlineNow.label": "'Online now'",
  "ui.overview.charts.online.slices.2_past24.color": "'#a1d99b'",
  "ui.overview.charts.online.slices.2_past24.filter":
    "Events.Inform > (NOW() - 5 * 60 * 1000) - (24 * 60 * 60 * 1000) AND Events.Inform < (NOW() - 5 * 60 * 1000)",
  "ui.overview.charts.online.slices.2_past24.label": "'Past 24 hours'",
  "ui.overview.charts.online.slices.3_others.color": "'#e5f5e0'",
  "ui.overview.charts.online.slices.3_others.filter":
    "Events.Inform < (NOW() - 5 * 60 * 1000) - (24 * 60 * 60 * 1000)",
  "ui.overview.charts.online.slices.3_others.label": "'Others'",
  "ui.overview.groups.online.label": "''",
  "ui.overview.groups.online.charts.0": "'online'",
};

describe("readOverviewConfig on the GENUINE native shape", () => {
  const uiConfig = walkNative(SEED_ROWS);

  it("materializes the native quirks the walk produces", () => {
    // These assertions pin the FIXTURE itself: if local-cache's walk
    // changes shape, this test says so loudly.
    const groups = (
      (uiConfig.overview as Record<string, unknown>).groups as Record<
        string,
        unknown
      >
    ).online as Record<string, unknown>;
    expect(groups.charts).toEqual({ "0": "online" }); // numeric-keyed OBJECT
    const onlineChart = (
      (uiConfig.overview as Record<string, unknown>).charts as Record<
        string,
        unknown
      >
    ).online as Record<string, unknown>;
    const slice = (
      (onlineChart.slices as Record<string, unknown>)["1_onlineNow"] as Record<
        string,
        unknown
      >
    )?.filter;
    expect(Array.isArray(slice)).toBe(true); // NOW() filter stays an AST
  });

  it("does not crash, resolves labels and stringifies AST filters", () => {
    const charts = readOverviewConfig(uiConfig as Record<string, unknown>);
    expect(charts).toHaveLength(1);
    const chart = charts[0];
    expect(chart.key).toBe("online");
    expect(chart.label).toBe("Online status");
    expect(chart.slices.map((s) => s.label)).toEqual([
      "Online now",
      "Past 24 hours",
      "Others",
    ]);
    for (const slice of chart.slices) {
      // The NOW() filter arrives as an AST and MUST become a string the
      // count contract accepts (native stringify, parseable).
      expect(typeof slice.filter).toBe("string");
      expect(slice.filter).toContain("Events.Inform");
      expect(slice.filter).not.toContain("[object");
    }
  });

  it("still accepts the legacy synthetic shape (arrays + string filters)", () => {
    const charts = readOverviewConfig({
      overview: {
        charts: {
          c1: {
            label: "Chart",
            slices: [{ label: "S", filter: "_tags = 'online'" }],
          },
        },
        groups: { g: { label: "", charts: ["c1"] } },
      },
    });
    expect(charts).toHaveLength(1);
    expect(charts[0].slices[0].filter).toBe("_tags = 'online'");
  });

  it("renders nothing on missing/empty config without throwing", () => {
    expect(readOverviewConfig(undefined)).toEqual([]);
    expect(readOverviewConfig({})).toEqual([]);
    expect(readOverviewConfig({ overview: {} })).toEqual([]);
    // Malformed entries degrade to null filters, never a crash.
    const charts = readOverviewConfig({
      overview: {
        charts: { x: { slices: { s: { filter: 42 } } } },
        groups: { g: { charts: { "0": "x", "1": "missing" } } },
      },
    });
    expect(charts).toHaveLength(1);
    expect(charts[0].slices[0].filter).toBeNull();
  });
});
