// The 20 model regressions ported 1:1 from the frozen reference
// (docs/design/reference-wan-model.md, tests/wan-model.test.cjs — SHA256
// bf60108b80cf288d2c3fcbff8ed87ce943102a4e962d238c48490d4d25146f06),
// plus the M05-A acceptance scenarios: three verified firmwares
// positive, unknown firmware/non-ZTE negative, VLAN blank/first-ID/
// untagged, PPP secret keep, typed booleans, read-only parameters and
// LAN binding validation. Dummy credentials only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWanTask,
  connectionModes,
  normalizeMode,
  readSettings,
} from "./wan-model.ts";
import type { WanDevice, WanSettings } from "./wan-types.ts";
import {
  WAN_IP,
  WAN_IP_INSTANCE,
  WAN_PPP,
  WAN_PPP_INSTANCE,
  makeZteWan,
} from "../../../test/fixtures/devices.ts";

const ip = WAN_IP_INSTANCE;
const ppp = WAN_PPP_INSTANCE;

function settings(device: WanDevice, base = ppp): WanSettings {
  return {
    ...readSettings(device, base),
    name: "INTERNET_1000",
    vlanEnable: true,
    vlan: "1000",
    priority: "0",
    service: "INTERNET",
    username: "test-user",
    password: "test-password",
    enable: true,
  };
}

test("uses advertised capabilities when no verified firmware correction applies", () => {
  const d = makeZteWan({});
  assert.equal(
    normalizeMode("bridge", connectionModes(d, ip)),
    "PPPoE_Bridged",
  );
  assert.throws(() => normalizeMode("IP_Bridged", connectionModes(d, ip)), {
    message: /didukung/,
  });
});

test("corrects the F670 firmware WAN IP enum without changing WAN PPP", () => {
  const d = makeZteWan({ model: "F670", firmware: "V6.0.10P3N19" });
  assert.deepEqual(connectionModes(d, ip), ["IP_Routed", "IP_Bridged"]);
  assert.deepEqual(connectionModes(d, WAN_IP), ["IP_Routed", "IP_Bridged"]);
  assert.equal(
    normalizeMode("bridge", connectionModes(d, ppp)),
    "PPPoE_Bridged",
  );
  const s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  });
  const task = buildWanTask(d, WAN_IP, ip, s);
  assert.equal(
    task.parameterValues.find(([p]) => p.endsWith(".ConnectionType"))[1],
    "IP_Bridged",
  );
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"].value[0] =
    "another-version";
  assert.equal(
    normalizeMode("bridge", connectionModes(d, ip)),
    "PPPoE_Bridged",
  );
});

test("keeps an actual connection mode even if absent from advertised capabilities", () => {
  const d = makeZteWan({});
  d[`${ip}.ConnectionType`].value[0] = "IP_Bridged";
  assert.ok(connectionModes(d, ip).includes("IP_Bridged"));
});

test("P3N3 WAN IP bridge uses IP_Bridged while WAN PPP keeps its advertised modes", () => {
  const d = makeZteWan({ model: "F670", firmware: "V6.0.10P3N3" });
  assert.deepEqual(connectionModes(d, ip), ["IP_Routed", "IP_Bridged"]);
  assert.equal(
    normalizeMode("bridge", connectionModes(d, WAN_IP)),
    "IP_Bridged",
  );
  assert.equal(
    normalizeMode("bridge", connectionModes(d, ppp)),
    "PPPoE_Bridged",
  );
  const s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    vlan: "20",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1",
  });
  const values = Object.fromEntries(
    buildWanTask(d, WAN_IP, ip, s).parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ip}.ConnectionType`], "IP_Bridged");
  assert.equal(values[`${ip}.X_ZTE-COM_VLANID`], 20);
  assert.equal(values[`${ip}.X_ZTE-COM_ServiceList`], "INTERNET");
});

test("F609 V5.2.10P5T13 creates a WAN IP bridge with VLAN1100 and SSID2", () => {
  const d = makeZteWan({ model: "F609", firmware: "V5.2.10P5T13" });
  assert.deepEqual(connectionModes(d, WAN_IP), ["IP_Routed", "IP_Bridged"]);
  assert.equal(
    normalizeMode("bridge", connectionModes(d, ppp)),
    "PPPoE_Bridged",
  );
  const s = settings(d, ip);
  Object.assign(s, {
    name: "other",
    mode: "bridge",
    vlan: "1100",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  });
  const task = buildWanTask(d, WAN_IP, null, s);
  const values = Object.fromEntries(
    task.parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(task.name, "addObject");
  assert.equal(values.ConnectionType, "IP_Bridged");
  assert.equal(values["X_ZTE-COM_VLANID"], 1100);
  assert.equal(
    values["X_ZTE-COM_LanInterface"],
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  );
  assert.equal(values.NATEnabled, false);
});

test("F670 WAN IP bridge converts OTHER service to the verified INTERNET combination", () => {
  const d = makeZteWan({ model: "F670", firmware: "V6.0.10P3N19" });
  const s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    service: "OTHER",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  });
  const task = buildWanTask(d, WAN_IP, ip, s);
  assert.equal(
    task.parameterValues.find(([p]) => p.endsWith(".X_ZTE-COM_ServiceList"))[1],
    "INTERNET",
  );
  s.mode = "IP_Routed";
  assert.equal(
    buildWanTask(d, WAN_IP, ip, s).parameterValues.find(([p]) =>
      p.endsWith(".X_ZTE-COM_ServiceList"),
    )[1],
    "OTHER",
  );
  s.mode = "bridge";
  assert.equal(
    buildWanTask(d, WAN_PPP, ppp, s).parameterValues.find(([p]) =>
      p.endsWith(".X_ZTE-COM_ServiceList"),
    )[1],
    "OTHER",
  );
  s.service = "TR069";
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /TR069/,
  });
});

test("supports a modem that actually advertises IP_Bridged", () => {
  const d = makeZteWan({});
  d[`${ip}.PossibleConnectionTypes`].value[0] = "IP_Routed,IP_Bridged";
  assert.equal(normalizeMode("bridge", connectionModes(d, ip)), "IP_Bridged");
});

test("does not invent bridge support when the modem has not reported it", () => {
  const d = makeZteWan({});
  delete d[`${ip}.PossibleConnectionTypes`];
  assert.throws(() => normalizeMode("bridge", connectionModes(d, ip)), {
    message: /didukung/,
  });
});

test("builds one complete typed PPPoE task", () => {
  const d = makeZteWan({}),
    task = buildWanTask(d, WAN_PPP, ppp, settings(d));
  assert.equal(task.name, "setParameterValues");
  const values = Object.fromEntries(
    task.parameterValues.map(([p, v, t]) => [p, [v, t]]),
  );
  assert.deepEqual(values[`${ppp}.Enable`], [true, "xsd:boolean"]);
  assert.deepEqual(values[`${ppp}.X_ZTE-COM_VLANEnable`], [
    1,
    "xsd:unsignedInt",
  ]);
  assert.deepEqual(values[`${ppp}.X_ZTE-COM_VLANID`], [
    1000,
    "xsd:unsignedInt",
  ]);
  assert.equal(values[`${ppp}.X_ZTE-COM_ServiceList`][0], "INTERNET");
  assert.equal(values[`${ppp}.Username`][0], "test-user");
  assert.equal(values[`${ppp}.Password`][0], "test-password");
  assert.ok(task.parameterValues.every(([p]) => p.startsWith(`${ppp}.`)));
});

test("initial values for a new object use relative names", () => {
  const d = makeZteWan({}),
    task = buildWanTask(d, WAN_PPP, null, settings(d));
  assert.equal(task.name, "addObject");
  assert.equal(task.objectName, WAN_PPP);
  assert.ok(task.parameterValues.every(([p]) => !p.includes(".")));
});

test("preserves the existing password when the password field is blank", () => {
  const d = makeZteWan({});
  d[`${ppp}.Username`].value[0] = "existing-user";
  const s = settings(d);
  s.password = "";
  const task = buildWanTask(d, WAN_PPP, ppp, s);
  assert.ok(!task.parameterValues.some(([p]) => p.endsWith(".Password")));
  assert.throws(() => buildWanTask(d, WAN_PPP, null, s), {
    message: /password/i,
  });
});

test("requires credentials for an unconfigured existing PPP object", () => {
  const d = makeZteWan({}),
    s = settings(d);
  s.password = "";
  assert.throws(() => buildWanTask(d, WAN_PPP, ppp, s), {
    message: /password/i,
  });
});

test("bridge sends a compatible mode, service, and disabled NAT together", () => {
  const d = makeZteWan({}),
    s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    service: "OTHER",
    lanBind: "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1",
  });
  const task = buildWanTask(d, WAN_IP, ip, s);
  const values = Object.fromEntries(
    task.parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ip}.ConnectionType`], "PPPoE_Bridged");
  assert.equal(values[`${ip}.X_ZTE-COM_ServiceList`], "OTHER");
  assert.equal(values[`${ip}.NATEnabled`], false);
  assert.ok(!(`${ip}.AddressingType` in values));
  assert.ok(!(`${ip}.Username` in values));
});

test("rejects a bridge carrying the TR069 service", () => {
  const d = makeZteWan({}),
    s = settings(d, ip);
  Object.assign(s, { mode: "bridge", service: "VoIP_TR069" });
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /TR069/,
  });
});

test("rejects missing bindings for an enabled bridge", () => {
  const d = makeZteWan({}),
    s = settings(d, ip);
  Object.assign(s, { mode: "bridge", service: "OTHER", lanBind: "" });
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /LAN/,
  });
});

test("validates VLAN, priority, and static IPv4 settings before enqueue", () => {
  const d = makeZteWan({}),
    s = settings(d);
  s.vlan = "4095";
  assert.throws(() => buildWanTask(d, WAN_PPP, ppp, s), {
    message: /VLAN/,
  });
  s.vlan = "1000";
  s.priority = "8";
  assert.throws(() => buildWanTask(d, WAN_PPP, ppp, s), {
    message: /prioritas/i,
  });
  Object.assign(s, {
    priority: "0",
    addressingType: "Static",
    ip: "300.1.2.3",
    mask: "255.255.255.0",
    gateway: "192.168.1.1",
  });
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /IPv4/,
  });
});

test("protects the actual active ACS interface from an accidental bridge conversion", () => {
  const d = makeZteWan({}),
    s = settings(d, ip);
  d[`${ip}.ExternalIPAddress`].value[0] = "192.168.170.250";
  d["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"] = {
    value: ["http://192.168.170.250:58000/path", "xsd:string"],
  };
  Object.assign(s, {
    mode: "bridge",
    service: "OTHER",
    lanBind: "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1",
  });
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /ACS aktif/,
  });
});

test("rejects a non-contiguous static subnet mask", () => {
  const d = makeZteWan({}),
    s = settings(d, ip);
  Object.assign(s, {
    addressingType: "Static",
    ip: "192.168.1.2",
    gateway: "192.168.1.1",
    mask: "255.0.255.0",
  });
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /Subnet mask/,
  });
});

test("uses numeric vendor flags when an older ZTE omits cached value types", () => {
  const d = makeZteWan({});
  d[`${ppp}.X_ZTE-COM_VLANEnable`] = { writable: true };
  const task = buildWanTask(d, WAN_PPP, ppp, settings(d));
  assert.deepEqual(
    task.parameterValues
      .find(([path]) => path.endsWith(".X_ZTE-COM_VLANEnable"))
      .slice(1),
    [1, "xsd:unsignedInt"],
  );
});

test("preserves an existing tagged VLAN when the modem omits VLANEnable", () => {
  const d = makeZteWan({});
  d[`${ip}.X_ZTE-COM_VLANEnable`] = { writable: true };
  d[`${ip}.X_ZTE-COM_VLANID`].value[0] = 100;
  const s = readSettings(d, ip);
  assert.equal(s.vlanEnable, true);
  assert.equal(s.vlan, "100");
});

// --- M05-A acceptance scenarios beyond the reference port ---

test("F670 P3N19 IP bridge has corrected service, enum and NAT", () => {
  const d = makeZteWan({
    model: "F670",
    firmware: "V6.0.10P3N19",
    id: "TEST-1",
  });
  const s = {
    ...readSettings(d, `${WAN_IP}.1`),
    mode: "bridge",
    service: "OTHER",
    enable: true,
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  };
  const t = buildWanTask(d, WAN_IP, `${WAN_IP}.1`, s);
  const v = Object.fromEntries(t.parameterValues.map(([p, x]) => [p, x]));
  assert.equal(v[`${WAN_IP}.1.ConnectionType`], "IP_Bridged");
  assert.equal(v[`${WAN_IP}.1.X_ZTE-COM_ServiceList`], "INTERNET");
  assert.equal(v[`${WAN_IP}.1.NATEnabled`], false);
});

test("all three verified firmwares build WAN IP bridges with the corrected enum", () => {
  for (const [model, firmware] of [
    ["F670", "V6.0.10P3N19"],
    ["F670", "V6.0.10P3N3"],
    ["F609", "V5.2.10P5T13"],
  ] as const) {
    const d = makeZteWan({ model, firmware, id: `TEST-${firmware}` });
    const s = settings(d, ip);
    Object.assign(s, {
      mode: "bridge",
      service: "OTHER",
      lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
    });
    const values = Object.fromEntries(
      buildWanTask(d, WAN_IP, ip, s).parameterValues.map(([p, v]) => [p, v]),
    );
    assert.equal(values[`${ip}.ConnectionType`], "IP_Bridged", model);
    assert.equal(values[`${ip}.NATEnabled`], false, model);
  }
});

test("unknown firmware keeps the advertised capability without a false correction", () => {
  const d = makeZteWan({ model: "F670", firmware: "unknown" });
  const s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    service: "OTHER",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  });
  const values = Object.fromEntries(
    buildWanTask(d, WAN_IP, ip, s).parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ip}.ConnectionType`], "PPPoE_Bridged");
  assert.equal(values[`${ip}.X_ZTE-COM_ServiceList`], "OTHER");
});

test("non-ZTE devices cannot use the ZTE WAN editor", () => {
  const d = makeZteWan({});
  d["DeviceID.Manufacturer"].value[0] = "Huawei";
  assert.throws(() => buildWanTask(d, WAN_IP, ip, settings(d, ip)), {
    message: /Editor ini/,
  });
});

test("a blank VLAN while tagging is enabled is rejected; untagged writes explicit zeros", () => {
  const d = makeZteWan({});
  const s = settings(d);
  s.vlanEnable = true;
  s.vlan = "";
  assert.throws(() => buildWanTask(d, WAN_PPP, ppp, s), {
    message: /VLAN/,
  });
  const untagged = settings(d);
  untagged.vlanEnable = false;
  const values = Object.fromEntries(
    buildWanTask(d, WAN_PPP, ppp, untagged).parameterValues.map(([p, v, t]) => [
      p,
      [v, t],
    ]),
  );
  assert.deepEqual(values[`${ppp}.X_ZTE-COM_VLANEnable`], [
    0,
    "xsd:unsignedInt",
  ]);
  assert.deepEqual(values[`${ppp}.X_ZTE-COM_VLANID`], [0, "xsd:unsignedInt"]);
});

test("a read-only parameter rejects changed values and omits unchanged ones", () => {
  const d = makeZteWan({});
  d[`${ip}.NATEnabled`].writable = false;
  const s = settings(d, ip);
  s.nat = true; // matches the read-only value: silently omitted
  const task = buildWanTask(d, WAN_IP, ip, s);
  assert.ok(!task.parameterValues.some(([p]) => p.endsWith(".NATEnabled")));
  s.nat = false;
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /hanya dapat dibaca/,
  });
});

test("LAN binding must be a comma-separated list of LAN/WLAN interface paths", () => {
  const d = makeZteWan({});
  const s = settings(d, ip);
  Object.assign(s, { lanBind: "InternetGatewayDevice.LANDevice.1" });
  assert.throws(() => buildWanTask(d, WAN_IP, ip, s), {
    message: /LAN Bind/,
  });
});
