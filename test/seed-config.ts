// Seed regressions (M06-C): idempotency (second run skips everything,
// nothing overwritten), preview writes nothing, credential-looking
// keys and the useradmin preset are refused, and no literal credential
// appears in the seed data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { planSeed, seedConfig } from "../scripts/seed-config.mjs";

const REQUIRED_DB = "genieacs_plan_test";

function loadSeed(): {
  ui: { config: Record<string, unknown> };
  presets: { presets: Record<string, unknown> };
} {
  return {
    ui: JSON.parse(readFileSync(path.resolve("config/seed/ui.json"), "utf8")),
    presets: JSON.parse(
      readFileSync(path.resolve("config/seed/presets.json"), "utf8"),
    ),
  };
}

void test("seed: idempotent, no overwrite, preview writes nothing", async () => {
  const url =
    process.env.MONGO_URL ?? `mongodb://127.0.0.1:27017/${REQUIRED_DB}`;
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db();
  const seed = loadSeed();
  try {
    // Clean slate for the seed keys.
    for (const item of planSeed(seed))
      await db.collection(item.kind).deleteOne({ _id: item.key });

    // Preview: no writes at all.
    const preview = await seedConfig({ mode: "preview", seed, client });
    assert.ok(preview.length > 0);
    assert.ok(preview.every((r) => r.status === "would-create"));
    for (const item of planSeed(seed))
      assert.equal(
        await db.collection(item.kind).countDocuments({ _id: item.key }),
        0,
      );

    // Bootstrap creates; a second run skips everything.
    const first = await seedConfig({ mode: "bootstrap", seed, client });
    assert.ok(first.every((r) => r.status === "created"));
    const second = await seedConfig({ mode: "bootstrap", seed, client });
    assert.ok(second.every((r) => r.status === "skipped-existing"));

    // An EXISTING value is never overwritten.
    await db
      .collection("config")
      .updateOne(
        { _id: "cwmp.connectionRequestTimeout" },
        { $set: { value: "9999", t: "xsd:unsignedInt" } },
      );
    const third = await seedConfig({ mode: "bootstrap", seed, client });
    assert.equal(
      third.find((r) => r.key === "cwmp.connectionRequestTimeout")?.status,
      "skipped-existing",
    );
    const doc = await db
      .collection("config")
      .findOne({ _id: "cwmp.connectionRequestTimeout" });
    assert.equal(doc?.value, "9999");
  } finally {
    await client.close();
  }
});

void test("seed: guards refuse credentials and useradmin", () => {
  const seed = loadSeed();
  assert.throws(
    () =>
      planSeed({
        ...seed,
        ui: { config: { "some.password": { value: "x" } } },
      }),
    /credential-looking/,
  );
  assert.throws(
    () =>
      planSeed({
        ...seed,
        presets: { presets: { useradmin: { precondition: "null" } } },
      }),
    /useradmin/,
  );
  // The real public seed contains no literal credentials.
  const raw =
    readFileSync(path.resolve("config/seed/ui.json"), "utf8") +
    readFileSync(path.resolve("config/seed/presets.json"), "utf8");
  assert.ok(!/password\s*[:=]\s*"[^"]+"/i.test(raw));
});
