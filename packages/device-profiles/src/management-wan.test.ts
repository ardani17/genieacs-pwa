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

test("no CRURL: critical SPV and WAN deletes demand diagnosis first", () => {
  const d = makeZteWan({});
  // PR #8 review (deliberately strengthened guard): without any CRURL
  // the write cannot be mapped to a management path, and missing
  // evidence is not permission — critical SPV on ANY WAN instance is
  // held (the old test asserted this was allowed).
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
  // Non-critical fields stay editable when the identity is unknown.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [spv(WAN_IP_INSTANCE, "Name", "x")]),
  );
});

// --- review follow-ups: bypass vectors must not reach the device ---

test("wildcard SPV and trailing-dot deletes cannot bypass the guard", () => {
  const d = managementFixture();
  const collection = WAN_IP;
  // Wildcard write covering the management instance.
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        {
          name: "setParameterValues",
          parameterValues: [[collection + ".*.Enable", false, "xsd:boolean"]],
        },
      ]),
    ManagementWanGuardError,
  );
  // Trailing-dot delete of the management instance.
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        { name: "deleteObject", objectName: WAN_IP_INSTANCE + "." },
      ]),
    ManagementWanGuardError,
  );
  // Trailing-dot delete of the whole collection.
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        { name: "deleteObject", objectName: collection + "." },
      ]),
    ManagementWanGuardError,
  );
});

test("provisions writing management-critical leaves are rejected", () => {
  const d = managementFixture();
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        {
          name: "provisions",
          provisions: [["value", WAN_IP_INSTANCE + ".Enable", false]],
        },
      ]),
    ManagementWanGuardError,
  );
  // A provision touching a different WAN stays allowed.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      {
        name: "provisions",
        provisions: [["value", WAN_PPP_INSTANCE + ".Enable", false]],
      },
    ]),
  );
});

// --- PR #8 review: the two reproduced guard bypasses, as regressions ---

test("unresolvable CRURL hostname holds critical SPV (review fixture 1)", () => {
  const d = makeZteWan({});
  d[`${WAN_IP_INSTANCE}.ExternalIPAddress`].value[0] = "192.0.2.10";
  d[CRURL] = { value: ["http://acs.example.invalid:7547/", "xsd:string"] };
  // No resolution results: the management identity is unknowable, so
  // disabling any WAN instance could sever the ACS path.
  assert.throws(
    () => assertManagementWanSafe(d, [spv(WAN_IP_INSTANCE, "Enable", false)]),
    ManagementWanGuardError,
  );
  // The same device WITH the resolution identifies the management WAN,
  // so a benign write on the other instance passes.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(
      d,
      [spv(WAN_PPP_INSTANCE, "Name", "x")],
      ["192.0.2.10"],
    ),
  );
});

test("wildcard provision on the identified management WAN is rejected (review fixture 2)", () => {
  const d = managementFixture();
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        {
          name: "provisions",
          provisions: [["value", WAN_IP + ".*.Enable", false]],
        },
      ]),
    ManagementWanGuardError,
  );
  // Trailing-dot and nested-wildcard spellings are held too.
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        {
          name: "provisions",
          provisions: [["value", WAN_IP + ".*.Enable.", false]],
        },
      ]),
    ManagementWanGuardError,
  );
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        {
          name: "provisions",
          provisions: [["value", WAN_IP_INSTANCE + ".*", false]],
        },
      ]),
    ManagementWanGuardError,
  );
  // A literal non-critical leaf on the management WAN stays allowed.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      {
        name: "provisions",
        provisions: [["value", WAN_IP_INSTANCE + ".Name", "x"]],
      },
    ]),
  );
  // A wildcard provision over a NON-management WAN stays allowed.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      {
        name: "provisions",
        provisions: [["value", WAN_PPP + ".*.Enable", false]],
      },
    ]),
  );
});

test("unresolvable CRURL hostname holds risky provisions", () => {
  const d = makeZteWan({});
  d[CRURL] = { value: ["http://acs.example.invalid:7547/", "xsd:string"] };
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        {
          name: "provisions",
          provisions: [["value", WAN_IP + ".*.Enable", false]],
        },
      ]),
    ManagementWanGuardError,
  );
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        {
          name: "provisions",
          provisions: [["value", WAN_IP_INSTANCE + ".Enable", false]],
        },
      ]),
    ManagementWanGuardError,
  );
  // Non-critical literal provision stays allowed.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      {
        name: "provisions",
        provisions: [["value", WAN_IP_INSTANCE + ".Name", "x"]],
      },
    ]),
  );
});

test("deleting WAN objects without any CRURL is refused with a diagnosis hint", () => {
  const d = makeZteWan({});
  // No ConnectionRequestURL: identity unknowable — destructive WAN
  // mutations must not pass silently.
  assert.throws(
    () =>
      assertManagementWanSafe(d, [
        { name: "deleteObject", objectName: WAN_IP_INSTANCE },
      ]),
    ManagementWanGuardError,
  );
  // Non-WAN deletes stay allowed without a CRURL.
  assert.doesNotThrow(() =>
    assertManagementWanSafe(d, [
      { name: "deleteObject", objectName: "InternetGatewayDevice.LANDevice.1" },
    ]),
  );
});
