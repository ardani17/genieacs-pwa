import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinuxVpnRuntime } from "../src/runtime.ts";
import { VpnController } from "../src/controller.ts";
import { routeMetric } from "../src/routes.ts";
const profile = {
  revision: 2,
  installationId: "11111111-1111-1111-1111-111111111111",
  server: "vpn.example.invalid",
  username: "fixture",
  password: "fixture-only",
  routes: [],
  mtu: 1400,
};
void test("start recovery failure then route_error stop preserves the journal until verified cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vpn-recovery-"));
  const route = {
    cidr: "10.0.0.0/8",
    dev: "ppp0",
    metric: routeMetric(profile.installationId, 1),
  };
  const path = join(dir, "routes.json");
  const journal = JSON.stringify({
    installationId: profile.installationId,
    revision: 1,
    routes: [route],
  });
  await writeFile(path, journal);
  let fail = true;
  const runtime = new LinuxVpnRuntime(dir, [], {
    assertHostSupported: async () => undefined,
    runIp: async (args) => {
      if (args[0] === "-j")
        return JSON.stringify([{ ...route, protocol: 186 }]);
      if (fail) throw new Error("fixture cleanup failure");
      return "";
    },
  });
  const controller = new VpnController(runtime);
  try {
    await controller.profile(profile);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(controller.status().state, "route_error");
    assert.equal(await readFile(path, "utf8"), journal);
    fail = false;
    await controller.stop();
    await assert.rejects(readFile(path), { code: "ENOENT" });
    await writeFile(path, '{"installationId":"foreign"}');
    await runtime.start(profile, () => undefined);
    await runtime.stop();
    assert.equal(await readFile(path, "utf8"), '{"installationId":"foreign"}');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
