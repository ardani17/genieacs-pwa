import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "seed.mjs",
);

const ALLOWED_DB = "genieacs_plan_test";

function run(args, env = {}) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [script, ...args], {
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 60_000,
      }),
    };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: String(err.stdout ?? "") + String(err.stderr ?? ""),
    };
  }
}

test("seeder refuses to run without --fixture-only", () => {
  const r = run([]);
  assert.notEqual(r.status, 0);
  assert.match(String(r.stdout), /--fixture-only/);
});

test("seeder refuses any database other than genieacs_plan_test", () => {
  const r = run(["--fixture-only", "--host", "127.0.0.1:27017/production"]);
  assert.notEqual(r.status, 0);
  assert.match(String(r.stdout), /genieacs_plan_test/);
});

test("seeder validates --count bounds", () => {
  assert.notEqual(run(["--fixture-only", "--count", "0"]).status, 0);
  assert.notEqual(run(["--fixture-only", "--count", "10001"]).status, 0);
});

// Negative connectivity test, SEPARATE from the positive one: a closed
// port must FAIL LOUDLY with the failure event and a nonzero exit.
test("seeder fails loudly when mongo is unreachable", () => {
  const r = run(["--fixture-only", "--count", "1", "--host", "127.0.0.1:1"]);
  assert.notEqual(r.status, 0);
  assert.match(String(r.stdout), /fixture.seed.failed/);
});

// Positive test: BOTH runs must exit 0 and the database must hold
// exactly the seeded identities afterwards. There is no tolerant
// "unreachable is fine" branch here — inside the check harness the
// fixture mongo is reachable; a failing seed fails this suite.
test("seeder is idempotent and the database holds the seeded devices", async () => {
  const host =
    process.env.SEED_HOST ?? process.env.MONGO_HOST ?? "127.0.0.1:27017";
  const r1 = run([
    "--fixture-only",
    "--count",
    "3",
    "--host",
    `${host}/${ALLOWED_DB}`,
  ]);
  assert.equal(r1.status, 0, `first seed run failed:\n${r1.stdout}`);
  assert.match(String(r1.stdout), /fixture.seed.completed/);

  const r2 = run([
    "--fixture-only",
    "--count",
    "3",
    "--host",
    `${host}/${ALLOWED_DB}`,
  ]);
  assert.equal(r2.status, 0, `second seed run failed:\n${r2.stdout}`);
  assert.match(String(r2.stdout), /fixture.seed.completed/);

  // Verify identity and count IN THE DATABASE: two runs must not
  // duplicate or drift.
  const credentials =
    process.env.SEED_USER && process.env.SEED_PASSWORD
      ? `${encodeURIComponent(process.env.SEED_USER)}:${encodeURIComponent(
          process.env.SEED_PASSWORD,
        )}@`
      : "";
  const client = new MongoClient(
    `mongodb://${credentials}${host}/?authSource=admin`,
    { serverSelectionTimeoutMS: 5000 },
  );
  try {
    await client.connect();
    const devices = client.db(ALLOWED_DB).collection("devices");
    const expected = [0, 1, 2].map(
      (i) => `TEST-DEVICE-${String(i).padStart(5, "0")}`,
    );
    for (const id of expected) {
      const doc = await devices.findOne({ _id: id });
      assert.ok(doc, `${id} must exist after seeding`);
      assert.equal(doc["DeviceID"]["ID"]["_value"], id);
    }
    const count = await devices.countDocuments({
      _id: { $in: expected },
    });
    assert.equal(count, 3, "exactly the three seeded devices, no duplicates");
  } finally {
    await client.close();
  }
});
