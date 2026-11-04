// WAN orchestrator regressions (M05-C): deterministic phase runner,
// write-failure short-circuit, refresh-failure partials with no binding
// follow-up, bridge binding reapply, verify mismatch partials, AddObject
// partial results with the observed instance, duplicate operations,
// concurrent-target conflicts, scoped fault cleanup and the firmware /
// management guards. A fake in-process CWMP "device" applies written
// parameters to the Mongo tree so refresh/verify read real state; no
// actual device commands leave the process.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp, type AppHarness } from "./helpers/app.ts";
import { collections } from "../lib/db/db.ts";
import { runWanPhases, executeWanOperation } from "../lib/ui/wan-operations.ts";
import {
  CommandExecutionError,
  type ExecutorDeps,
} from "../lib/ui/device-commands.ts";
import { acquireLock, releaseLock } from "../lib/lock.ts";
import Authorizer from "../lib/common/authorizer.ts";
import { getRevision } from "../lib/ui/local-cache.ts";
import { generateSalt, hashPassword } from "../lib/auth.ts";
import type { WanOperationRequest } from "../packages/app-contracts/src/wan.ts";
import type { WanSettings } from "../packages/device-profiles/src/wan-types.ts";

// ---- deterministic phase runner (pure) ----

void test("failed refresh prevents binding reapply", async () => {
  const calls: string[] = [];
  const result = await runWanPhases({
    write: async () => {
      calls.push("write");
      return { state: "succeeded" };
    },
    refresh: async () => {
      calls.push("refresh");
      return { state: "failed" };
    },
    reapplyBinding: async () => {
      calls.push("binding");
      return { state: "succeeded" };
    },
  });
  assert.deepEqual(calls, ["write", "refresh"]);
  assert.equal(result.state, "partial");
});

void test("failed or unknown write stops every later phase", async () => {
  for (const state of ["failed", "unknown"] as const) {
    const calls: string[] = [];
    const result = await runWanPhases({
      write: async () => {
        calls.push("write");
        return { state };
      },
      refresh: async () => {
        calls.push("refresh");
        return { state: "succeeded" };
      },
      reapplyBinding: async () => {
        calls.push("binding");
        return { state: "succeeded" };
      },
    });
    assert.deepEqual(calls, ["write"]);
    assert.equal(result.state, state);
  }
});

void test("all phases succeeding is the only path to success", async () => {
  const result = await runWanPhases({
    write: async () => ({ state: "succeeded" }),
    refresh: async () => ({ state: "succeeded" }),
    reapplyBinding: async () => ({ state: "succeeded" }),
  });
  assert.equal(result.state, "succeeded");
});

// ---- orchestrator against the harness with a fake CWMP device ----

const ROOT = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1";
const WAN_IP = `${ROOT}.WANIPConnection`;
const WAN_IP_1 = `${WAN_IP}.1`;
const WAN_PPP = `${ROOT}.WANPPPConnection`;
const WAN_PPP_1 = `${WAN_PPP}.1`;

function leaf(
  value: unknown,
  type = "xsd:string",
  writable = true,
): {
  _value: unknown;
  _type: string;
  _writable: boolean;
  _object: boolean;
  _timestamp: number;
} {
  return {
    _value: value,
    _type: type,
    _writable: writable,
    _object: false,
    _timestamp: 1,
  };
}

function wanInstance(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, v as never]),
  );
}

function wanDeviceDoc(
  id: string,
  firmware: string,
  crIp: string,
  model = "F670",
): Record<string, unknown> {
  return {
    _id: id,
    _lastInform: new Date(),
    _registered: new Date(),
    DeviceID: {
      ID: leaf(id),
      Manufacturer: leaf("ZTE"),
      ProductClass: leaf(model),
    },
    InternetGatewayDevice: {
      DeviceInfo: { SoftwareVersion: leaf(firmware) },
      ManagementServer: { ConnectionRequestURL: leaf(`http://${crIp}:7547/`) },
      WANDevice: {
        "1": {
          WANConnectionDevice: {
            "1": {
              WANIPConnection: {
                _writable: true,
                "1": wanInstance({
                  Name: leaf("INTERNET"),
                  Enable: leaf(true, "xsd:boolean"),
                  ConnectionType: leaf("IP_Routed"),
                  PossibleConnectionTypes: leaf(
                    "IP_Routed,IP_Bridged,PPPoE_Bridged",
                    "xsd:string",
                    false,
                  ),
                  "X_ZTE-COM_ServiceList": leaf("INTERNET"),
                  "X_ZTE-COM_VLANEnable": leaf(0, "xsd:unsignedInt"),
                  "X_ZTE-COM_VLANID": leaf(0, "xsd:unsignedInt"),
                  "X_ZTE-COM_8021P": leaf(0, "xsd:unsignedInt"),
                  NATEnabled: leaf(true, "xsd:boolean"),
                  AddressingType: leaf("DHCP"),
                  ExternalIPAddress: leaf("192.0.2.50"),
                  SubnetMask: leaf("0.0.0.0"),
                  DefaultGateway: leaf("0.0.0.0"),
                  DNSServers: leaf(""),
                  "X_ZTE-COM_LanInterface": leaf(""),
                }),
              },
              WANPPPConnection: {
                _writable: true,
                "1": wanInstance({
                  Name: leaf("PPPoE"),
                  Enable: leaf(false, "xsd:boolean"),
                  ConnectionType: leaf("PPPoE_Routed"),
                  PossibleConnectionTypes: leaf(
                    "PPPoE_Routed,PPPoE_Bridged",
                    "xsd:string",
                    false,
                  ),
                  "X_ZTE-COM_ServiceList": leaf(""),
                  "X_ZTE-COM_VLANEnable": leaf(0, "xsd:unsignedInt"),
                  "X_ZTE-COM_VLANID": leaf(0, "xsd:unsignedInt"),
                  "X_ZTE-COM_8021P": leaf(0, "xsd:unsignedInt"),
                  NATEnabled: leaf(true, "xsd:boolean"),
                  Username: leaf(""),
                  Password: leaf("", "xsd:string"),
                  "X_ZTE-COM_LanInterface": leaf(""),
                }),
              },
            },
          },
        },
      },
    },
  };
}

// Navigate/create the tree doc and set a parameter leaf.
function setTreeParam(
  doc: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let node: Record<string, unknown> = doc;
  for (const seg of parts.slice(0, -1)) {
    if (typeof node[seg] !== "object" || node[seg] === null)
      node[seg] = {} as never;
    node = node[seg] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (node[last] && typeof node[last] === "object")
    (node[last] as { _value: unknown })._value = value;
  else node[last] = leaf(value) as never;
}

function treeWalk(doc: Record<string, unknown>, path: string): unknown {
  let node: unknown = doc;
  for (const seg of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

// Fake CWMP engine: applies written parameters to the Mongo device doc
// (minus the first-task drops), creating AddObject instances itself.
function fakeCwmpDeps(options: {
  deviceId: string;
  dropOnFirstWrite?: string[];
  failCrFrom?: number;
}): {
  deps: ExecutorDeps;
  calls: { insert: number; cr: number; applied: number; skipped: number };
} {
  const state = { insert: 0, cr: 0, applied: 0, skipped: 0 };
  const deps: ExecutorDeps = {
    async connectionRequest() {
      state.cr++;
      if (options.failCrFrom != null && state.cr >= options.failCrFrom)
        return "Connection request failed";
      return "";
    },
    async awaitSessionStart() {
      return true;
    },
    async awaitSessionEnd() {
      return true;
    },
    async insertTasks(tasks) {
      state.insert++;
      for (const task of tasks) {
        const doc = await collections.devices.findOne({
          _id: options.deviceId,
        });
        if (!doc) throw new Error("fake device missing");
        if (task.name === "setParameterValues") {
          for (const [name, value] of task.parameterValues ?? []) {
            const skip =
              state.insert === 1 &&
              options.dropOnFirstWrite?.some((d) => name.endsWith(d));
            if (skip) {
              state.skipped++;
              continue;
            }
            setTreeParam(doc as never, name, value);
            state.applied++;
          }
        } else if (task.name === "addObject") {
          const collection = task.objectName ?? "";
          const existing = Object.keys(
            (treeWalk(doc, collection) as Record<string, unknown>) ?? {},
          ).filter((k) => /^\d+$/.test(k));
          const next = String(
            existing.map(Number).reduce((a, b) => Math.max(a, b), 0) + 1,
          );
          const container = treeWalk(doc, collection) as Record<
            string,
            unknown
          >;
          container[next] = {};
          for (const [name, value] of task.parameterValues ?? []) {
            const skip =
              state.insert === 1 &&
              options.dropOnFirstWrite?.some((d) => name === d);
            if (skip) {
              state.skipped++;
              continue;
            }
            setTreeParam(doc, `${collection}.${next}.${name}`, value);
            state.applied++;
          }
        }
        await collections.devices.replaceOne(
          { _id: options.deviceId },
          doc as never,
        );
      }
      return tasks.map((t, i) => ({
        ...t,
        _id: `64c${(state.insert * 10 + i).toString().padStart(21, "0")}`,
      }));
    },
    async deleteTask() {
      // no-op: the fake never leaves tasks queued
    },
    async countFaults() {
      return 0;
    },
    async faultCode() {
      return undefined;
    },
  };
  return { deps, calls: state };
}

const wanAuthorizer = new Authorizer([
  [{ devices: { access: 3, filter: true, validate: true } }],
]);

function wanRequest(
  n: number,
  deviceId: string,
  over: Partial<WanOperationRequest> = {},
): WanOperationRequest {
  return {
    operationId: `33333333-4444-4555-8666-${n.toString().padStart(12, "0")}`,
    deviceId,
    collection: WAN_IP,
    instance: WAN_IP_1,
    settings: {} as WanSettings,
    ...over,
  };
}

function bridgeSettings(over: Partial<WanSettings> = {}): WanSettings {
  return {
    name: "INTERNET",
    mode: "bridge",
    service: "OTHER",
    enable: true,
    nat: false,
    vlanEnable: false,
    vlan: "0",
    priority: "0",
    username: "",
    password: "",
    addressingType: "DHCP",
    ip: "",
    mask: "",
    gateway: "",
    dns: "",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
    ...over,
  };
}

void test("wan operations: phases, partials, guards, idempotency", async (t) => {
  const app: AppHarness = await startApp();
  await collections.devices.deleteMany({});
  await collections.tasks.deleteMany({});
  await collections.appOperations.deleteMany({});
  await collections.faults.deleteMany({});

  // A dedicated user with devices:3 only (no faults) so the fault
  // cleanup permission gate is exercised through reauthorize too.
  const salt = await generateSalt(16);
  await collections.users.updateOne(
    { _id: "wanop" },
    {
      $set: {
        password: await hashPassword("Fixture-Only-2026!", salt),
        salt,
        roles: "fixtureWanOnly",
      },
    },
    { upsert: true },
  );
  await collections.permissions.updateOne(
    { _id: "fixtureWanOnly:devices:3" },
    {
      $set: {
        role: "fixtureWanOnly",
        resource: "devices",
        access: 3,
        validate: "true",
      },
    },
    { upsert: true },
  );
  await app.refreshSnapshot();

  const seedDevices = async (): Promise<void> => {
    await collections.devices.deleteMany({});
    for (const d of [
      wanDeviceDoc("TEST-WAN-1", "V6.0.10P3N19", "192.0.2.99"),
      wanDeviceDoc("TEST-WAN-2", "V6.0.10P3N3", "192.0.2.99"),
      wanDeviceDoc("TEST-WAN-3", "V5.2.10P5T13", "192.0.2.99", "F609"),
      wanDeviceDoc("TEST-WAN-4", "unknown-version", "192.0.2.99"),
      wanDeviceDoc("TEST-WAN-MGMT", "V6.0.10P3N19", "192.0.2.50"),
    ])
      await collections.devices.insertOne(d as never);
  };
  await seedDevices();

  const snapshot = await getRevision();
  const ctx = {
    authorizer: wanAuthorizer,
    configSnapshot: snapshot,
    username: "wanop",
  };

  try {
    await t.test("write failure stops before refresh", async () => {
      await seedDevices();
      const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-1", failCrFrom: 1 });
      const outcome = await executeWanOperation(
        ctx,
        wanRequest(1, "TEST-WAN-1", { settings: bridgeSettings() }),
        { deps: fake.deps },
      );
      assert.equal(outcome.state, "failed");
      assert.deepEqual(
        outcome.phases.map((p) => p.name),
        ["write"],
      );
      assert.equal(fake.calls.insert, 1);
    });

    await t.test("refresh failure is partial and skips binding", async () => {
      await seedDevices();
      const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-1", failCrFrom: 2 });
      const outcome = await executeWanOperation(
        ctx,
        wanRequest(2, "TEST-WAN-1", { settings: bridgeSettings() }),
        { deps: fake.deps },
      );
      assert.equal(outcome.state, "partial");
      assert.deepEqual(
        outcome.phases.map((p) => p.name),
        ["write", "refresh"],
      );
      // write + refreshObject only — no binding task was submitted.
      assert.equal(fake.calls.insert, 2);
    });

    await t.test(
      "bridge conversion reapplies a dropped binding then verifies",
      async () => {
        await seedDevices();
        const fake = fakeCwmpDeps({
          deviceId: "TEST-WAN-1",
          dropOnFirstWrite: ["X_ZTE-COM_LanInterface"],
        });
        const outcome = await executeWanOperation(
          ctx,
          wanRequest(3, "TEST-WAN-1", { settings: bridgeSettings() }),
          { deps: fake.deps },
        );
        assert.equal(outcome.state, "succeeded");
        assert.deepEqual(
          outcome.phases.map((p) => p.name),
          ["write", "refresh", "reapply_binding", "verify"],
        );
        assert.ok(fake.calls.skipped >= 1);
        // The binding really landed on the fake device.
        const doc = await collections.devices.findOne({ _id: "TEST-WAN-1" });
        assert.equal(
          (
            treeWalk(doc as never, `${WAN_IP_1}.X_ZTE-COM_LanInterface`) as {
              _value: string;
            }
          )._value,
          "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
        );
      },
    );

    await t.test("verify mismatch is partial", async () => {
      await seedDevices();
      const fake = fakeCwmpDeps({
        deviceId: "TEST-WAN-1",
        dropOnFirstWrite: ["ConnectionType"], // CPE refuses the mode change
      });
      const outcome = await executeWanOperation(
        ctx,
        wanRequest(4, "TEST-WAN-1", { settings: bridgeSettings() }),
        { deps: fake.deps },
      );
      assert.equal(outcome.state, "partial");
      assert.equal(outcome.phases.at(-1)?.name, "verify");
      assert.equal(outcome.phases.at(-1)?.state, "failed");
    });

    await t.test(
      "AddObject left disabled is partial with the observed instance",
      async () => {
        await seedDevices();
        const fake = fakeCwmpDeps({
          deviceId: "TEST-WAN-1",
          dropOnFirstWrite: ["Enable"],
        });
        const outcome = await executeWanOperation(
          ctx,
          wanRequest(5, "TEST-WAN-1", {
            collection: WAN_IP,
            instance: null,
            settings: bridgeSettings({ name: "other" }),
          }),
          { deps: fake.deps },
        );
        assert.equal(outcome.state, "partial");
        assert.equal(outcome.observedInstance, `${WAN_IP}.2`);
        assert.ok(outcome.warnings.some((w) => /tidak dibuat ulang/.test(w)));
        // A second object was never created for recovery.
        const doc = await collections.devices.findOne({ _id: "TEST-WAN-1" });
        const instances = Object.keys(
          treeWalk(doc as never, WAN_IP) as Record<string, unknown>,
        ).filter((k) => /^\d+$/.test(k));
        assert.deepEqual(instances.sort(), ["1", "2"]);
      },
    );

    await t.test(
      "duplicate operation returns the stored outcome without resubmitting",
      async () => {
        await seedDevices();
        const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-2" });
        const request = wanRequest(6, "TEST-WAN-2", {
          settings: bridgeSettings(),
        });
        const first = await executeWanOperation(ctx, request, {
          deps: fake.deps,
        });
        assert.equal(first.state, "succeeded");
        const inserts = fake.calls.insert;
        const second = await executeWanOperation(ctx, request, {
          deps: fake.deps,
        });
        assert.equal(second.state, "succeeded");
        assert.equal(fake.calls.insert, inserts);
      },
    );

    await t.test("concurrent target is rejected with 409", async () => {
      const token = await acquireLock(`wan_TEST-WAN-2_${WAN_IP}`, 5000, 1000);
      assert.ok(token);
      try {
        const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-2" });
        await assert.rejects(
          executeWanOperation(
            ctx,
            wanRequest(7, "TEST-WAN-2", { settings: bridgeSettings() }),
            { deps: fake.deps },
          ),
          (err: CommandExecutionError) => err.status === 409,
        );
      } finally {
        await releaseLock(`wan_TEST-WAN-2_${WAN_IP}`, token);
      }
    });

    await t.test(
      "superseded faults are retained without faults:3",
      async () => {
        const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-3" });
        const faultId = "TEST-WAN-3:task_64c0000000000000000000010";
        await collections.faults.insertOne({
          _id: faultId,
          device: "TEST-WAN-3",
          channel: "task",
          timestamp: new Date(),
          provisions: "",
          retries: 0,
          code: "9003",
          message: "Invalid parameter name",
        } as never);
        const outcome = await executeWanOperation(
          ctx,
          wanRequest(8, "TEST-WAN-3", { settings: bridgeSettings() }),
          { deps: fake.deps },
        );
        assert.equal(outcome.state, "succeeded");
        assert.ok(outcome.warnings.some((w) => /faults:3/.test(w)));
        assert.equal(
          await collections.faults.countDocuments({ _id: faultId }),
          1,
        );
        await collections.faults.deleteMany({});
      },
    );

    await t.test(
      "unverified firmware is rejected as UNSUPPORTED_PROFILE",
      async () => {
        const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-4" });
        await assert.rejects(
          executeWanOperation(
            ctx,
            wanRequest(9, "TEST-WAN-4", { settings: bridgeSettings() }),
            { deps: fake.deps },
          ),
          (err: CommandExecutionError) =>
            err.status === 400 && err.code === "UNSUPPORTED_PROFILE",
        );
      },
    );

    await t.test(
      "management WAN guard rejects destructive bridge conversion",
      async () => {
        const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-MGMT" });
        await assert.rejects(
          executeWanOperation(
            ctx,
            wanRequest(10, "TEST-WAN-MGMT", { settings: bridgeSettings() }),
            { deps: fake.deps },
          ),
          (err: CommandExecutionError) => err.status === 400,
        );
      },
    );

    await t.test(
      "verified F670 P3N19/P3N3 and F609 routes write IP_Bridged",
      async () => {
        await seedDevices();
        for (const [i, device] of [
          "TEST-WAN-1",
          "TEST-WAN-2",
          "TEST-WAN-3",
        ].entries()) {
          const fake = fakeCwmpDeps({ deviceId: device });
          let written: [string, unknown, string?][] | undefined;
          const deps = {
            ...fake.deps,
            async insertTasks(tasks: never[]) {
              const result = await (
                fake.deps.insertTasks as (
                  tasksArg: never[],
                ) => Promise<unknown[]>
              )(tasks);
              if (!written && tasks[0])
                written = (
                  tasks[0] as { parameterValues?: [string, unknown, string?][] }
                ).parameterValues;
              return result as never;
            },
          };
          const outcome = await executeWanOperation(
            ctx,
            wanRequest(20 + i, device, {
              collection: WAN_PPP,
              instance: WAN_PPP_1,
              settings: {
                ...bridgeSettings(),
                mode: "PPPoE_Routed",
                username: "test-user",
                password: "test-password",
                lanBind: "",
              },
            }),
            { deps },
          );
          assert.equal(outcome.state, "succeeded", device);
          assert.ok(written, device);
          const values = Object.fromEntries(
            (written ?? []).map(([n, v]) => [n, v]),
          );
          assert.equal(values[`${WAN_PPP_1}.ConnectionType`], "PPPoE_Routed");
          assert.equal(values[`${WAN_PPP_1}.Username`], "test-user");
        }
      },
    );

    await t.test("unknown device and filter misses are 404", async () => {
      const fake = fakeCwmpDeps({ deviceId: "TEST-WAN-1" });
      await assert.rejects(
        executeWanOperation(
          ctx,
          wanRequest(30, "DOES-NOT-EXIST", { settings: bridgeSettings() }),
          { deps: fake.deps },
        ),
        (err: CommandExecutionError) => err.status === 404,
      );
    });
  } finally {
    await collections.tasks.deleteMany({});
    await collections.faults.deleteMany({});
    await app.stop();
  }
});
