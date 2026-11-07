import test from "node:test";
import assert from "node:assert/strict";

import { inventory, packageNameFromPath } from "./inventory.mjs";

test("keeps distinct transitive paths in shrinkwrap v2", () => {
  const rows = inventory({
    lockfileVersion: 2,
    packages: {
      "": { name: "root", version: "1.2.16" },
      "node_modules/qs": { version: "6.15.0" },
      "node_modules/a/node_modules/qs": { version: "6.17.1", dev: true },
    },
  });
  assert.equal(rows.filter((x) => x.name === "qs").length, 2);
  assert.equal(rows.find((x) => x.path.includes("/a/")).dev, true);
});

test("derives package names from the last node_modules segment", () => {
  assert.equal(packageNameFromPath("node_modules/koa"), "koa");
  assert.equal(packageNameFromPath("node_modules/@types/node"), "@types/node");
  assert.equal(
    packageNameFromPath("node_modules/foo/node_modules/@babel/core"),
    "@babel/core",
  );
});

test("accepts package-lock v3 and keeps dev/optional flags", () => {
  const rows = inventory({
    lockfileVersion: 3,
    packages: {
      "": { name: "web", version: "0.1.0" },
      "node_modules/eslint": { version: "10.14.0", dev: true },
      "node_modules/cpu-features": { version: "0.0.11", optional: true },
      "node_modules/linked": { link: true, resolved: "packages/linked" },
    },
  });
  assert.deepEqual(
    rows.map((x) => [x.name, x.version]),
    [
      ["cpu-features", "0.0.11"],
      ["eslint", "10.14.0"],
    ],
  );
  assert.equal(rows.find((x) => x.name === "eslint").dev, true);
  assert.equal(rows.find((x) => x.name === "cpu-features").optional, true);
});

test("rejects unsupported or malformed lock schema with LOCK_SCHEMA", () => {
  for (const bad of [
    null,
    {},
    { lockfileVersion: 1, packages: {} },
    { lockfileVersion: 2 },
    { lockfileVersion: 2, packages: "nope" },
    { lockfileVersion: 4, packages: {} },
  ]) {
    assert.throws(
      () => inventory(bad),
      (err) => err.code === "LOCK_SCHEMA",
    );
  }
});
