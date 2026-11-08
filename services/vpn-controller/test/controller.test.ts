import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { VpnController } from "../src/controller.ts";
import { createVpnServer } from "../src/server.ts";
import type { Event } from "../src/state.ts";
import type { DesiredVpnProfile } from "../../../packages/app-contracts/src/vpn.ts";
import { authenticationRejected } from "../src/ppp-events.ts";

const profile = (revision = 1): DesiredVpnProfile => ({
  revision,
  installationId: "11111111-1111-1111-1111-111111111111",
  server: "vpn.example.invalid",
  username: "fixture",
  password: "fixture-only",
  mtu: 1400,
  routes: ["10.77.0.0/16"],
});
const tick = (): Promise<unknown> =>
  new Promise((resolve) => setTimeout(resolve, 0));
void test("controller serializes revisions, rejects duplicate reconnect and ignores stale PPP events", async () => {
  const starts: DesiredVpnProfile[] = [];
  const callbacks: ((e: Event) => void)[] = [];
  const controller = new VpnController({
    start: async (p, emit) => {
      starts.push(p);
      callbacks.push(emit);
    },
    stop: async () => undefined,
    diagnose: async () => ({}),
  });
  try {
    await Promise.all([
      controller.profile(profile(1)),
      controller.profile(profile(2)),
    ]);
    assert.deepEqual(
      starts.map((p) => p.revision),
      [1, 2],
    );
    await assert.rejects(controller.reconnect(), /CONFLICT/);
    callbacks[0]({ type: "auth_rejected" });
    await tick();
    assert.equal(controller.status().state, "connecting");
    callbacks[1]({ type: "auth_rejected" });
    await tick();
    assert.equal(controller.status().state, "auth_failed");
    await controller.reconnect();
    assert.equal(starts.length, 3);
    callbacks[1]({ type: "down", code: "LATE_EXIT" });
    await tick();
    assert.equal(controller.status().state, "connecting");
    await assert.rejects(controller.profile(profile(1)), /CONFLICT/);
    assert.equal(
      JSON.stringify(controller.status()).includes("fixture-only"),
      false,
    );
  } finally {
    await controller.stop();
  }
});
void test("internal HTTP requires a scoped token and request UUID; strict commands", async () => {
  const controller = new VpnController({
    start: async () => undefined,
    stop: async () => undefined,
    diagnose: async () => ({ source: "fixture" }),
  });
  const server = createVpnServer(controller, () =>
    Buffer.from("controller-fixture-token"),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = {
    Authorization: "Bearer controller-fixture-token",
    "X-Request-Id": randomUUID(),
    "Content-Type": "application/json",
  };
  try {
    assert.equal((await fetch(url + "/status")).status, 401);
    assert.equal(
      (
        await fetch(url + "/status", {
          headers: { ...headers, Authorization: "Bearer acs-token" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(url + "/status", {
          headers: { Authorization: headers.Authorization },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(url + "/profile", {
          method: "PUT",
          headers,
          body: JSON.stringify({ ...profile(), command: "id" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(url + "/profile", {
          method: "PUT",
          headers,
          body: JSON.stringify(profile()),
        })
      ).status,
      200,
    );
    assert.equal(
      (await fetch(url + "/reconnect", { method: "POST", headers, body: "{}" }))
        .status,
      409,
    );
    assert.equal(
      (
        await fetch(url + "/diagnose", {
          method: "POST",
          headers,
          body: '{"host":"attacker"}',
        })
      ).status,
      400,
    );
    const status = await (await fetch(url + "/status", { headers })).text();
    assert.equal(status.includes("fixture-only"), false);
  } finally {
    await controller.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
void test("PPP authentication failures are classified without replaying daemon log text", () => {
  for (const message of [
    "PAP authentication failed",
    "CHAP authentication failure",
    "pppd exited with status 19",
    "status = 19",
    "child_handler : pppd exited for call 123 with code 19",
  ])
    assert.equal(authenticationRejected(message), true, message);
  assert.equal(authenticationRejected("LCP timeout"), false);
});
void test("device probes use only installed ONT routes and the current PPP source address", async () => {
  let emit: (event: Event) => void = () => undefined;
  const calls: unknown[] = [];
  const controller = new VpnController({
    start: async (_profile, callback) => {
      emit = callback;
    },
    stop: async () => undefined,
    diagnose: async () => ({}),
    probe: async (host, port, localIp) => {
      calls.push({ host, port, localIp });
      return {
        status: "ok",
        durationMs: 1,
        observedAt: new Date().toISOString(),
      };
    },
  });
  try {
    await controller.profile(profile());
    await assert.rejects(
      controller.probe({ host: "10.77.1.2", port: 80 }),
      /UNCONFIGURED/,
    );
    emit({
      type: "up",
      interfaceName: "ppp0",
      localIp: "10.77.0.2",
      peerIp: "10.77.0.1",
    });
    await tick();
    await controller.probe({ host: "10.77.1.2", port: 80 });
    assert.deepEqual(calls, [
      { host: "10.77.1.2", port: 80, localIp: "10.77.0.2" },
    ]);
    await assert.rejects(
      controller.probe({ host: "192.168.1.1", port: 80 }),
      /INVALID_PROFILE/,
    );
    await assert.rejects(
      controller.probe({ host: "10.77.1.2", port: 80, command: "scan" }),
      /INVALID_PROFILE/,
    );
    assert.equal(calls.length, 1);
  } finally {
    await controller.stop();
  }
});
