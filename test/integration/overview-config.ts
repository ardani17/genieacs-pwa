// RE-SPEC-08 companion: pins the ENGINE's local-cache walk against
// drift. The web normalizer (apps/web/src/features/overview/overview-config.ts)
// consumes the uiConfig the SessionDTO passes through verbatim; this
// test asserts the REAL listener materializes the seeded ui.overview
// rows into exactly that shape — numeric-keyed group charts and
// AST-valued filters. If local-cache ever changes, this fails FIRST so
// the fixture in the web tests gets updated deliberately.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";
import { del as cacheDel } from "../../lib/cache.ts";

void test("session uiConfig carries the native ui.overview shape", async () => {
  const app = await startApp();
  try {
    // The genuine seed rows (lib/init.ts options.overview).
    await collections.config.deleteMany({ _id: /^ui\.overview\./ });
    const rows = {
      "ui.overview.charts.online.label": "'Online status'",
      "ui.overview.charts.online.slices.1_onlineNow.filter":
        "Events.Inform > NOW() - 5 * 60 * 1000",
      "ui.overview.charts.online.slices.1_onlineNow.label": "'Online now'",
      "ui.overview.groups.online.charts.0": "'online'",
    };
    for (const [id, value] of Object.entries(rows))
      await collections.config.updateOne(
        { _id: id },
        { $set: { value } },
        { upsert: true },
      );

    await cacheDel("ui-local-cache-hash");
    await new Promise((r) => setTimeout(r, 5300));

    const res = await app.appRequest("/api/session", {}, "admin");
    assert.equal(res.status, 200);
    // The native session endpoint returns the safe DTO at the TOP
    // level (the {ok,data} envelope is the BFF's, not the engine's).
    const body = (await res.json()) as {
      uiConfig: Record<string, unknown>;
    };
    const overview = body.uiConfig.overview as Record<string, unknown>;

    const groups = overview.groups as Record<string, unknown>;
    const online = groups.online as Record<string, unknown>;
    // Numeric trailing segment -> numeric-keyed OBJECT (iterating it
    // with for...of throws — the crash RE-SPEC-08 reported).
    assert.deepEqual(online.charts, { "0": "online" });

    const charts = overview.charts as Record<string, unknown>;
    const onlineChart = charts.online as Record<string, unknown>;
    const slices = onlineChart.slices as Record<string, unknown>;
    const slice = slices["1_onlineNow"] as Record<string, unknown>;
    // NOW() rows stay EVALUATED ASTs (arrays) — not strings.
    assert.ok(Array.isArray(slice.filter), "filter is the AST array");
    assert.equal(slice.label, "Online now");
  } finally {
    await app.stop();
  }
});
