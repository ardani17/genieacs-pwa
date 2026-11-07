import test from "node:test";
import assert from "node:assert/strict";
import { runPreflight } from "./preflight.mjs";

test("PPP absence is actionable and never reported connected", () => {
  const r = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "6.18.0",
    pppDevice: false,
    pppModules: false,
    routeOverlap: false,
  });
  assert.equal(r.supported, false);
  assert.equal(r.checks.find((x) => x.id === "ppp")?.status, "fail");
  assert.ok(
    r.checks.find((x) => x.id === "ppp")?.message.includes("ppp"),
    "the failure must tell the operator what to do",
  );
});

test("a fully capable linux host is supported", () => {
  const r = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "6.12.4",
    pppDevice: true,
    pppModules: true,
    routeOverlap: false,
  });
  assert.equal(r.supported, true);
  assert.deepEqual(
    r.checks.map((c) => c.status),
    r.checks.map(() => "pass"),
  );
});

test("non-linux or rootless hosts fail with reasons", () => {
  for (const facts of [
    {
      os: "win32",
      rootful: true,
      kernel: "10.0",
      pppDevice: false,
      pppModules: false,
      routeOverlap: false,
    },
    {
      os: "linux",
      rootful: false,
      kernel: "6.12",
      pppDevice: true,
      pppModules: true,
      routeOverlap: false,
    },
  ]) {
    const r = runPreflight(facts);
    assert.equal(r.supported, false);
    assert.equal(r.reason, "host_unsupported");
  }
});

test("subnet overlap fails; kernel inside the mongo-warned range only warns", () => {
  const r = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "6.19.12",
    pppDevice: true,
    pppModules: true,
    routeOverlap: true,
  });
  assert.equal(r.supported, false);
  assert.equal(r.checks.find((x) => x.id === "routes")?.status, "fail");
  assert.equal(r.checks.find((x) => x.id === "mongo-kernel")?.status, "warn");

  const edge = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "7.0.13",
    pppDevice: true,
    pppModules: true,
    routeOverlap: false,
  });
  assert.equal(
    edge.checks.find((x) => x.id === "mongo-kernel")?.status,
    "warn",
  );
  const outside = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "7.0.14",
    pppDevice: true,
    pppModules: true,
    routeOverlap: false,
  });
  assert.equal(
    outside.checks.find((x) => x.id === "mongo-kernel")?.status,
    "pass",
  );
});

test("partial ppp availability warns instead of failing silently", () => {
  const r = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "6.12",
    pppDevice: true,
    pppModules: false,
    routeOverlap: false,
    wsl: true,
  });
  assert.equal(r.supported, true);
  assert.equal(r.checks.find((x) => x.id === "ppp")?.status, "warn");
  assert.equal(r.checks.find((x) => x.id === "wsl")?.status, "warn");
});

test("output never includes environment contents", () => {
  const r = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "6.12",
    pppDevice: true,
    pppModules: true,
    routeOverlap: false,
  });
  const serialized = JSON.stringify(r);
  for (const marker of [
    "PATH",
    "SECRET",
    "PASSWORD",
    process.env.PATH ?? "__none__",
  ]) {
    if (marker && marker !== "__none__")
      assert.ok(!serialized.includes(marker));
  }
});
