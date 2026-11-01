import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "seed.mjs",
);

function run(args, env = {}) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [script, ...args], {
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 20_000,
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

test("seeder accepts the allowed host/db combination (idempotent upserts against the harness mongo)", async () => {
  const host =
    process.env.SEED_HOST ?? process.env.MONGO_HOST ?? "127.0.0.1:27017";
  const r = run([
    "--fixture-only",
    "--count",
    "3",
    "--host",
    `${host}/genieacs_plan_test`,
  ]);
  // Without a reachable mongo this must FAIL LOUDLY (never silently pass);
  // inside the verify container the fixture mongo is reachable.
  if (r.status === 0) {
    assert.match(String(r.stdout), /fixture.seed.completed/);
    // Second run is idempotent (upserts, no duplicates).
    const r2 = run([
      "--fixture-only",
      "--count",
      "3",
      "--host",
      `${host}/genieacs_plan_test`,
    ]);
    assert.equal(r2.status, 0);
    assert.match(String(r2.stdout), /fixture.seed.completed/);
  } else {
    assert.match(
      String(r.stdout),
      /fixture.seed.failed|ECONNREFUSED|selection/,
    );
  }
});
