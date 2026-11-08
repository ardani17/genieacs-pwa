import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRoutes,
  routeArgs,
  removeOwnedRoutes,
  routeMetric,
} from "../src/routes.ts";

void test("reject default routes, canonical duplicates, ingress overlap and injection", () => {
  for (const routes of [
    ["0.0.0.0/0"],
    ["1.2.3.4/0"],
    ["10.0.0.1/8", "10.2.0.0/8"],
    ["172.18.1.0/24"],
    ["10.0.0.0/8; id"],
    ["999.0.0.0/8"],
  ])
    assert.throws(() => validateRoutes(routes, ["172.18.0.0/16"]));
  assert.deepEqual(validateRoutes(["10.0.1.2/16"], ["172.18.0.0/16"]), [
    "10.0.0.0/16",
  ]);
});
void test("cleanup deletes only the recorded exact route with ownership protocol and metric", async () => {
  const metric = routeMetric("fixture-installation", 4);
  const own = { cidr: "10.0.0.0/8", dev: "ppp0", metric };
  const calls: string[][] = [];
  await removeOwnedRoutes(
    async (args) => {
      calls.push(args);
      return args[0] === "-j"
        ? JSON.stringify([{ ...own, protocol: 186 }])
        : "";
    },
    [own],
  );
  assert.deepEqual(calls[1], routeArgs("del", own));
  assert.ok(
    calls[0].includes("-N"),
    "ip must return numeric protocol IDs rather than names such as bgp",
  );
  assert.equal(calls.flat().includes("flush"), false);
  assert.ok(calls[1].includes("186"));
  assert.notEqual(metric, routeMetric("other-installation", 4));
});
void test("cleanup failure is surfaced and foreign route ownership is untouched", async () => {
  const own = { cidr: "10.0.0.0/8", dev: "ppp0", metric: 12345 };
  await assert.rejects(
    removeOwnedRoutes(
      async (args) => {
        if (args[0] === "-j")
          return JSON.stringify([{ ...own, protocol: 186 }]);
        throw new Error("fixture deletion failure");
      },
      [own],
    ),
    /deletion failure/,
  );
  const calls: string[][] = [];
  await removeOwnedRoutes(
    async (args) => {
      calls.push(args);
      return JSON.stringify([{ ...own, protocol: 186, metric: 54321 }]);
    },
    [own],
  );
  assert.equal(calls.length, 1);
});
