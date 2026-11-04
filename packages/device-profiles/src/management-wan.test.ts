// Management-WAN guard regressions (M05-A). The legacy UI only guarded
// the editor form; the strengthened SERVER guard must reject raw
// setParameterValues/deleteObject on the active ACS path — and on any
// WAN whose identity is ambiguous — while leaving other WAN edits and
// native reboot/factoryReset flows untouched.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ManagementWanGuardError,
  assertManagementWanSafe,
  managementWanInstances,
} from "./management-wan.ts";
import type { GuardedWanTask } from "./management-wan.ts";
import {
  WAN_IP,
  WAN_IP_INSTANCE,
  WAN_PPP,
  WAN_PPP_INSTANCE,
  makeZteWan,
} from "../../../test/fixtures/devices.ts";

const CRURL = "InternetGatewayDevice.ManagementServer.ConnectionRequestURL";

function managementFixture(): ReturnType<typeof makeZteWan> {
  const d = makeZteWan({});
  d[`${WAN_IP_INSTANCE}.ExternalIPAddress`].value[0] = "192.0.2.10";
  d[CRURL] = { value: ["http://192.0.2.10:7547/", "xsd:string"] };
  return d;
}

function spv(instance: string, leaf: string, v: unknown): GuardedWanTask {
  return {
    name: "setParameterValues",
    parameterValues: [[`${instance}.${leaf}`, v, "xsd:string"]],
  };
}

test("identifies the management WAN from the CRURL host", () => {
  const d = managementFixture();
  const { paths, ambiguous } = managementWanInstances(d);
  assert.deepEqual(paths, [WAN_IP_INSTANCE]);
  assert.equal(ambiguous, false);
});

test("DNS-named CRURL hosts match through server-provided resolutions only", () => {
  const d = makeZteWan({});
  d[`${WAN_IP_INSTANCE}.ExternalIPAddress`].value[0] = "192.0.2.50";
  d[CRURL] = {
    value: ["http://acs.example.invalid:7547/", "xsd:string"],
  };
  // Without resolution results a DNS name never equals a WAN IP.
  assert.deepEqual(managementWanInstances(d).paths, []);
  const resolved = managementWanInstances(d, ["192.0.2.50"]);
  assert.deepEqual(resolved.paths, [WAN_IP_INSTANCE]);
  assert.equal(resolved.ambiguous, false);
});

test("rejects critical SPV on the management WAN but allows other WANs and benign fields", () => {
  const d = managementFixture();
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        spv(WAN_IP_INSTANCE, "ConnectionType", "IP_Bridged"),
      ]),
    ManagementWanGuardError,
  );
  assert.throws(
    () => assertManagementWanSafe(d, [spv(WAN_IP_INSTANCE, "Enable", false)]),
    ManagementWanGuardError,
  );
  // Another WAN instance stays editable.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      spv(WAN_PPP_INSTANCE, "ConnectionType", "IP_Bridged"),
    ]),
  );
  // Non-critical fields on the management WAN stay editable.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [spv(WAN_IP_INSTANCE, "Name", "x")]),
  );
});

test("rejects deleteObject of the management instance or its collection", () => {
  const d = managementFixture();
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        { name: "deleteObject", objectName: WAN_IP_INSTANCE },
      ]),
    ManagementWanGuardError,
  );
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        { name: "deleteObject", objectName: WAN_IP },
      ]),
    ManagementWanGuardError,
  );
  // Deleting an unrelated WAN is allowed.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      { name: "deleteObject", objectName: WAN_PPP_INSTANCE },
    ]),
  );
});

test("ambiguous WAN identity rejects destructive edits on every matching instance", () => {
  const d = managementFixture();
  d[`${WAN_PPP_INSTANCE}.ExternalIPAddress`].value[0] = "192.0.2.10";
  const { paths, ambiguous } = managementWanInstances(d);
  assert.equal(ambiguous, true);
  assert.equal(paths.length, 2);
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        spv(WAN_IP_INSTANCE, "ConnectionType", "IP_Bridged"),
      ]),
    { message: /tidak unik/ },
  );
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        { name: "deleteObject", objectName: WAN_PPP_INSTANCE },
      ]),
    { message: /tidak unik/ },
  );
});

test("guard errors carry VALIDATION and a diagnosis instruction", () => {
  const d = managementFixture();
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        { name: "deleteObject", objectName: WAN_IP_INSTANCE },
      ]),
    (err: ManagementWanGuardError) => {
      assert.equal(err.code, "VALIDATION");
      assert.match(err.message, /diagnosis|TR069/);
      return true;
    },
  );
});

test("native non-WAN tasks are never blocked by the guard", () => {
  const d = managementFixture();
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      { name: "reboot" },
      { name: "factoryReset" },
      { name: "download", fileType: "1 Firmware Upgrade Image" },
      { name: "getParameterValues", parameterNames: [`${WAN_IP_INSTANCE}.`] },
      { name: "refreshObject", objectName: WAN_IP_INSTANCE },
      { name: "addObject", objectName: WAN_IP },
    ]),
  );
});

test("no CRURL means no protected path and edits are allowed", () => {
  const d = makeZteWan({});
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      spv(WAN_IP_INSTANCE, "ConnectionType", "IP_Bridged"),
      { name: "deleteObject", objectName: WAN_IP_INSTANCE },
    ]),
  );
});
