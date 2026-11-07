// Executor regressions (M05-B): normalizeTaskOutcome mapping, whitelist
// + management-WAN guard before insert, idempotent claims, accurate
// outcomes (CR failure / fault 9003 / pending / timeout), cleanup in
// finally, crash no-replay, and the legacy route's native pending
// cleanup staying intact. Devices/fixtures are synthetic; no real
// device commands are ever sent (CR targets are TEST-NET or refused
// loopback ports).
import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers/app.ts";
import { collections } from "../lib/db/db.ts";
import {
  CommandExecutionError,
  executeAuthorizedTasks,
  normalizeTaskOutcome,
  type ExecutorDeps,
} from "../lib/ui/device-commands.ts";
import {
  requestFingerprint,
  sweepStaleOperations,
} from "../lib/ui/operation-store.ts";
import Authorizer from "../lib/common/authorizer.ts";
import { getRevision } from "../lib/ui/local-cache.ts";

// ---- pure outcome normalization (no database) ----

void test("pending and CR failure cannot become success", () => {
  assert.equal(
    normalizeTaskOutcome({ status: "Connection request failed", tasks: [] })
      .state,
    "failed",
  );
  assert.equal(
    normalizeTaskOutcome({ status: "", tasks: [{ status: "pending" }] }).state,
    "unknown",
  );
  assert.equal(
    normalizeTaskOutcome({ status: "", tasks: [{ status: "done" }] }).state,
    "succeeded",
  );
});

void test("fault, timeout and lost confirmation map to failed/unknown", () => {
  assert.equal(
    normalizeTaskOutcome({
      status: "",
      tasks: [{ status: "done" }, { status: "fault" }],
    }).state,
    "failed",
  );
  assert.equal(
    normalizeTaskOutcome({
      status: "Session took too long to complete",
      tasks: [{ status: "done" }],
    }).state,
    "unknown",
  );
  assert.equal(
    normalizeTaskOutcome({
      status: "No contact from CPE",
      tasks: [{ status: "pending" }],
    }).state,
    "unknown",
  );
});

// ---- executor against the real engine harness ----

const WAN_IP_1 =
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1";
const WAN_PPP_2 =
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2";

function leaf(
  value: unknown,
  type = "xsd:string",
): { _value: unknown; _type: string; _object: boolean; _timestamp: number } {
  return { _value: value, _type: type, _object: false, _timestamp: 1 };
}

function deviceDoc(
  id: string,
  crUrl: string,
  wanIp: string,
): Record<string, unknown> {
  return {
    _id: id,
    _lastInform: new Date(),
    _registered: new Date(),
    DeviceID: {
      ID: leaf(id),
      Manufacturer: leaf("ZTE"),
      ProductClass: leaf("F670"),
    },
    InternetGatewayDevice: {
      DeviceInfo: { SoftwareVersion: leaf("V6.0.10P3N19") },
      ManagementServer: { ConnectionRequestURL: leaf(crUrl) },
      WANDevice: {
        "1": {
          WANConnectionDevice: {
            "1": {
              WANIPConnection: {
                "1": {
                  ExternalIPAddress: leaf(wanIp),
                  ConnectionType: leaf("IP_Routed"),
                },
              },
              WANPPPConnection: {
                "2": { ExternalIPAddress: leaf("192.0.2.99") },
              },
            },
          },
        },
      },
    },
  };
}

// Stubbed engine deps: nothing leaves the process, every effect is
// counted so tests can prove insertion/cleanup behavior.
function stubTaskId(n: number): string {
  return `64b${n.toString().padStart(21, "0")}`; // 24 hex chars
}

interface StubCalls {
  insert: number;
  delete: number;
  faults: string[];
}

function stubDeps(over: Partial<ExecutorDeps> = {}): {
  deps: ExecutorDeps;
  calls: StubCalls;
} {
  const state: StubCalls = { insert: 0, delete: 0, faults: [] };
  const deps: ExecutorDeps = {
    async connectionRequest() {
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
      return tasks.map((t, i) => ({
        ...t,
        _id: stubTaskId(state.insert * 10 + i),
      }));
    },
    async deleteTask() {
      state.delete++;
    },
    async countFaults(deviceId, taskId) {
      return state.faults.includes(`${deviceId}:task_${taskId}`) ? 1 : 0;
    },
    async faultCode(deviceId, taskId) {
      return state.faults.includes(`${deviceId}:task_${taskId}`)
        ? "9003"
        : undefined;
    },
    ...over,
  };
  return { deps, calls: state };
}

// PermissionSet = array of per-resource permission maps (see
// lib/ui.ts: Object.values(allPermissions[role]) per role). Note the
// native default for an unset filter is TRUE (allow-all), not null —
// local-cache parses absent filters to true.
const adminAuthorizer = new Authorizer([
  [{ devices: { access: 3, filter: true, validate: true } }],
]);
const readOnlyAuthorizer = new Authorizer([
  [{ devices: { access: 2, filter: true } }],
]);

const OP = (n: number): string =>
  `22222222-3333-4444-8555-${n.toString().padStart(12, "0")}`;

void test("executor: guards, idempotency, outcomes, cleanup, legacy parity", async (t) => {
  const app = await startApp();
  await collections.devices.deleteMany({});
  await collections.tasks.deleteMany({
    device: { $in: ["TEST-CMD-1", "TEST-CMD-2"] },
  });
  await collections.appOperations.deleteMany({});
  // TEST-CMD-1: management WAN identified (CRURL host == WAN IP).
  await collections.devices.insertOne(
    deviceDoc("TEST-CMD-1", "http://192.0.2.10:7547/", "192.0.2.10") as never,
  );
  // TEST-CMD-2: malformed CRURL — the REAL connection-request path
  // fails deterministically ("Invalid connection request URL") without
  // depending on container network behavior.
  await collections.devices.insertOne(
    deviceDoc("TEST-CMD-2", "not-a-url", "192.0.2.11") as never,
  );
  const snapshot = await getRevision();
  const base = {
    authorizer: adminAuthorizer,
    configSnapshot: snapshot,
    username: "admin",
  };

  try {
    await t.test("authorizer deny inserts nothing", async () => {
      const { deps, calls } = stubDeps();
      await assert.rejects(
        executeAuthorizedTasks(
          { ...base, authorizer: readOnlyAuthorizer },
          "TEST-CMD-1",
          [{ name: "reboot" }],
          { deps },
        ),
        (err: CommandExecutionError) => err.status === 403,
      );
      assert.equal(calls.insert, 0);
    });

    await t.test("101 tasks are rejected before insert", async () => {
      const { deps, calls } = stubDeps();
      const tasks = Array.from({ length: 101 }, () => ({ name: "reboot" }));
      await assert.rejects(
        executeAuthorizedTasks(base, "TEST-CMD-1", tasks, { deps }),
        (err: CommandExecutionError) =>
          err.status === 400 && /maksimal 100/.test(err.message),
      );
      assert.equal(calls.insert, 0);
    });

    await t.test(
      "raw delete/SPV on the management WAN is rejected",
      async () => {
        const { deps, calls } = stubDeps();
        await assert.rejects(
          executeAuthorizedTasks(
            base,
            "TEST-CMD-1",
            [{ name: "deleteObject", objectName: WAN_IP_1 }],
            { deps },
          ),
          (err: CommandExecutionError) => err.status === 400,
        );
        await assert.rejects(
          executeAuthorizedTasks(
            base,
            "TEST-CMD-1",
            [
              {
                name: "setParameterValues",
                parameterValues: [
                  [`${WAN_IP_1}.ConnectionType`, "IP_Bridged", "xsd:string"],
                ],
              },
            ],
            { deps },
          ),
          (err: CommandExecutionError) => err.status === 400,
        );
        assert.equal(calls.insert, 0);
        // Editing another WAN instance stays allowed.
        const other = stubDeps();
        const ok = await executeAuthorizedTasks(
          base,
          "TEST-CMD-1",
          [
            {
              name: "setParameterValues",
              parameterValues: [[`${WAN_PPP_2}.Name`, "x", "xsd:string"]],
            },
          ],
          { deps: other.deps },
        );
        assert.equal(ok.state, "succeeded");
        assert.equal(other.calls.insert, 1);
      },
    );

    await t.test("same operation twice submits exactly once", async () => {
      const { deps, calls } = stubDeps();
      const tasks = [{ name: "reboot" }];
      const opts = {
        operation: {
          operationId: OP(1),
          kind: "commands",
          fingerprint: requestFingerprint({
            deviceId: "TEST-CMD-1",
            tasks,
          }),
        },
        deps,
      };
      const first = await executeAuthorizedTasks(
        base,
        "TEST-CMD-1",
        tasks,
        opts,
      );
      assert.equal(first.state, "succeeded");
      assert.equal(first.claim, "new");
      assert.equal(calls.insert, 1);
      const second = await executeAuthorizedTasks(
        base,
        "TEST-CMD-1",
        tasks,
        opts,
      );
      assert.equal(second.claim, "existing");
      assert.equal(second.state, "succeeded");
      assert.equal(calls.insert, 1);
    });

    await t.test(
      "same operationId with a different body is a conflict",
      async () => {
        const { deps } = stubDeps();
        await assert.rejects(
          executeAuthorizedTasks(base, "TEST-CMD-1", [{ name: "reboot" }], {
            operation: {
              operationId: OP(1),
              kind: "commands",
              fingerprint: requestFingerprint({
                deviceId: "TEST-CMD-1",
                tasks: [{ name: "factoryReset" }],
              }),
            },
            deps,
          }),
          (err: CommandExecutionError) => err.status === 409,
        );
      },
    );

    await t.test("CR failure is failed and still cleans up tasks", async () => {
      const { deps, calls } = stubDeps({
        async connectionRequest() {
          return "Connection request failed";
        },
      });
      const result = await executeAuthorizedTasks(
        base,
        "TEST-CMD-1",
        [{ name: "reboot" }],
        {
          deps,
          operation: {
            operationId: OP(2),
            kind: "commands",
            fingerprint: requestFingerprint({
              deviceId: "TEST-CMD-1",
              tasks: [{ name: "reboot" }],
            }),
          },
        },
      );
      assert.equal(result.state, "failed");
      assert.equal(result.statuses[0].status, "pending");
      assert.equal(calls.delete, 1);
    });

    await t.test("fault 9003 becomes failed with the fault code", async () => {
      const stub = stubDeps();
      stub.calls.faults.push(`TEST-CMD-1:task_${stubTaskId(10)}`);
      const result = await executeAuthorizedTasks(
        base,
        "TEST-CMD-1",
        [{ name: "reboot" }],
        {
          deps: stub.deps,
          operation: {
            operationId: OP(3),
            kind: "commands",
            fingerprint: requestFingerprint({
              deviceId: "TEST-CMD-1",
              tasks: [{ name: "reboot" }],
            }),
          },
        },
      );
      assert.equal(result.state, "failed");
      assert.equal(result.statuses[0].status, "fault");
      assert.equal(result.statuses[0].faultCode, "9003");
      assert.equal(result.phases[0].faultCode, "9003");
    });

    await t.test("session timeout and lost contact stay unknown", async () => {
      const timeout = stubDeps({
        async awaitSessionEnd() {
          return false;
        },
      });
      const t1 = await executeAuthorizedTasks(
        base,
        "TEST-CMD-1",
        [{ name: "reboot" }],
        { deps: timeout.deps },
      );
      assert.equal(t1.state, "unknown");
      const noContact = stubDeps({
        async awaitSessionStart() {
          return false;
        },
      });
      const t2 = await executeAuthorizedTasks(
        base,
        "TEST-CMD-1",
        [{ name: "reboot" }],
        { deps: noContact.deps },
      );
      assert.equal(t2.state, "unknown");
    });

    await t.test(
      "cleanup runs even when the outcome probe throws",
      async () => {
        const broken = stubDeps({
          async countFaults() {
            throw new Error("probe failure");
          },
        });
        await assert.rejects(
          executeAuthorizedTasks(base, "TEST-CMD-1", [{ name: "reboot" }], {
            deps: broken.deps,
          }),
        );
        assert.equal(broken.calls.delete, 1);
      },
    );

    await t.test(
      "crashed in_progress operation becomes unknown without replay",
      async () => {
        await collections.appOperations.insertOne({
          _id: OP(9),
          user: "admin",
          device: "TEST-CMD-1",
          kind: "commands",
          fingerprint: requestFingerprint({
            deviceId: "TEST-CMD-1",
            tasks: [{ name: "reboot" }],
          }),
          state: "in_progress",
          phases: [],
          createdAt: new Date(Date.now() - 120_000),
          updatedAt: new Date(Date.now() - 120_000),
          expiresAt: new Date(Date.now() + 86_400_000),
        });
        const swept = await sweepStaleOperations();
        assert.ok(swept >= 1);
        const { deps, calls } = stubDeps();
        const result = await executeAuthorizedTasks(
          base,
          "TEST-CMD-1",
          [{ name: "reboot" }],
          {
            deps,
            operation: {
              operationId: OP(9),
              kind: "commands",
              fingerprint: requestFingerprint({
                deviceId: "TEST-CMD-1",
                tasks: [{ name: "reboot" }],
              }),
            },
          },
        );
        assert.equal(result.claim, "existing");
        assert.equal(result.state, "unknown");
        assert.equal(calls.insert, 0);
      },
    );

    await t.test(
      "operation result: owner reads it, stranger cannot",
      async () => {
        const owner = await app.appRequest(
          `/api/app/operations/${OP(1)}`,
          {},
          "admin",
        );
        assert.equal(owner.status, 200);
        const body = (await owner.json()) as {
          ok: boolean;
          data: { state: string };
        };
        assert.equal(body.ok, true);
        assert.equal(body.data.state, "succeeded");

        const stranger = await app.appRequest(
          `/api/app/operations/${OP(1)}`,
          {},
          "restricted",
        );
        assert.equal(stranger.status, 403);

        const missing = await app.appRequest(
          `/api/app/operations/${OP(42)}`,
          {},
          "admin",
        );
        assert.equal(missing.status, 404);
      },
    );

    await t.test(
      "legacy tasks route keeps native pending cleanup",
      async () => {
        const res = await app.appRequest(
          "/api/devices/TEST-CMD-2/tasks",
          { method: "POST", body: JSON.stringify([{ name: "reboot" }]) },
          "admin",
        );
        assert.equal(res.status, 200);
        const statuses = (await res.json()) as { status: string }[];
        assert.equal(statuses.length, 1);
        assert.ok(["pending", "done", "fault"].includes(statuses[0].status));
        // The deterministic CR failure leaves statuses pending; the
        // attempted task is still cleaned up exactly like the native
        // route did.
        assert.equal(
          await collections.tasks.countDocuments({ device: "TEST-CMD-2" }),
          0,
        );
      },
    );

    await t.test(
      "hostname CRURL resolves through the server resolver",
      async () => {
        // CRURL uses a DNS name the stub resolver maps to the WAN IP —
        // a critical SPV on that WAN must be refused. Without the
        // resolution the guard sees no match and the write goes out.
        const dnsDevice = deviceDoc(
          "TEST-DNS-1",
          "http://acs.example.invalid:7547/",
          "192.0.2.60",
        );
        await collections.devices.insertOne(dnsDevice as never);
        const okDeps = stubDeps();
        try {
          await assert.rejects(
            executeAuthorizedTasks(
              base,
              "TEST-DNS-1",
              [
                {
                  name: "setParameterValues",
                  parameterValues: [
                    [`${WAN_IP_1}.ConnectionType`, "IP_Bridged", "xsd:string"],
                  ],
                },
              ],
              {
                deps: {
                  ...okDeps.deps,
                  async resolveHosts(host) {
                    return host === "acs.example.invalid" ? ["192.0.2.60"] : [];
                  },
                },
              },
            ),
            (err: CommandExecutionError) => err.status === 400,
          );
          // A failed resolution keeps the identity unknowable — the
          // strengthened guard blocks the destructive delete.
          await assert.rejects(
            executeAuthorizedTasks(
              base,
              "TEST-DNS-1",
              [{ name: "deleteObject", objectName: WAN_IP_1 }],
              {
                deps: {
                  ...okDeps.deps,
                  async resolveHosts() {
                    throw new Error("resolver down");
                  },
                },
              },
            ),
            (err: CommandExecutionError) => err.status === 400,
          );
        } finally {
          await collections.devices.deleteOne({ _id: "TEST-DNS-1" });
        }
      },
    );

    await t.test(
      "client task internals are stripped and expiry is clamped",
      async () => {
        const capture = stubDeps();
        const seen: unknown[] = [];
        const deps = {
          ...capture.deps,
          async insertTasks(tasks) {
            seen.push(...tasks);
            return capture.deps.insertTasks(tasks);
          },
        };
        const result = await executeAuthorizedTasks(
          base,
          "TEST-CMD-1",
          [
            {
              name: "reboot",
              expiry: -5,
              timestamp: "2099-01-01T00:00:00Z",
              uniqueKey: "evil",
              _id: "client-id",
            } as never,
          ],
          { deps },
        );
        assert.equal(result.state, "succeeded");
        const task = seen[0] as Record<string, unknown>;
        assert.equal(task["device"], "TEST-CMD-1");
        assert.equal(task["expiry"], 1); // clamped, not negative
        assert.equal(task["timestamp"], undefined);
        assert.equal(task["uniqueKey"], undefined);
        assert.equal(task["_id"], undefined);
      },
    );

    await t.test(
      "app commands endpoint end-to-end with idempotency",
      async () => {
        const body = JSON.stringify({
          operationId: OP(5),
          deviceId: "TEST-CMD-2",
          tasks: [{ name: "reboot" }],
        });
        const first = await app.appRequest(
          "/api/app/devices/TEST-CMD-2/commands",
          { method: "POST", body },
          "admin",
        );
        assert.equal(first.status, 200);
        const firstJson = (await first.json()) as {
          ok: boolean;
          data: { state: string; operationId: string };
        };
        assert.equal(firstJson.ok, true);
        assert.equal(firstJson.data.operationId, OP(5));
        // Real CR path against the malformed URL: a deterministic
        // failure, never success and never unknown-as-success.
        assert.equal(firstJson.data.state, "failed");

        const second = await app.appRequest(
          "/api/app/devices/TEST-CMD-2/commands",
          { method: "POST", body },
          "admin",
        );
        assert.equal(second.status, 200);
        const secondJson = (await second.json()) as { data: { state: string } };
        assert.equal(secondJson.data.state, firstJson.data.state);
        assert.equal(
          await collections.tasks.countDocuments({ device: "TEST-CMD-2" }),
          0,
        );

        const conflict = await app.appRequest(
          "/api/app/devices/TEST-CMD-2/commands",
          {
            method: "POST",
            body: JSON.stringify({
              operationId: OP(5),
              deviceId: "TEST-CMD-2",
              tasks: [{ name: "factoryReset" }],
            }),
          },
          "admin",
        );
        assert.equal(conflict.status, 409);

        const badRequest = await app.appRequest(
          "/api/app/devices/TEST-CMD-2/commands",
          {
            method: "POST",
            body: JSON.stringify({ operationId: "not-a-uuid", tasks: [] }),
          },
          "admin",
        );
        assert.equal(badRequest.status, 400);

        const denied = await app.appRequest(
          "/api/app/devices/TEST-CMD-2/commands",
          { method: "POST", body },
          "operator",
        );
        assert.equal(denied.status, 403);
      },
    );
  } finally {
    await collections.tasks.deleteMany({
      device: { $in: ["TEST-CMD-1", "TEST-CMD-2"] },
    });
    await app.stop();
  }
});
