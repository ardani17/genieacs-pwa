// WiFi model regressions (M05-E): discovery from real parameter paths
// (band never from the SSID number), keep never writes a blank key,
// replacement validates the PSK and requires a plausible security mode,
// unsupported mappings are refused instead of guessed.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWifiTask, readWifi } from "./wifi.ts";
import { makeZteWan } from "../../../test/fixtures/devices.ts";

const WLAN2 = "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2";

function wifiFixture(): ReturnType<typeof makeZteWan> {
  const d = makeZteWan({});
  d[`${WLAN2}.SSID`] = { value: ["Lab", "xsd:string"], writable: true };
  d[`${WLAN2}.Enable`] = { value: [true, "xsd:boolean"], writable: true };
  d[`${WLAN2}.Standard`] = {
    value: ["802.11b/g/n", "xsd:string"],
    writable: false,
  };
  d[`${WLAN2}.BeaconType`] = { value: ["11i", "xsd:string"], writable: false };
  d[`${WLAN2}.PreSharedKey.1.PreSharedKey`] = {
    value: ["", "xsd:string"],
    writable: true,
  };
  return d;
}

test("readWifi discovers radios from actual paths with the device band", () => {
  const d = wifiFixture();
  d["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID"] = {
    value: ["Guest", "xsd:string"],
    writable: true,
  };
  // NO Standard on instance 5: band stays undefined, never inferred
  // from the instance number.
  d["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable"] = {
    value: [false, "xsd:boolean"],
    writable: false,
  };
  const radios = readWifi(d);
  assert.equal(radios.length, 2);
  const radio2 = radios.find((r) => r.id === WLAN2);
  assert.equal(radio2?.ssid, "Lab");
  assert.equal(radio2?.band, "802.11b/g/n");
  assert.equal(radio2?.keyPath, `${WLAN2}.PreSharedKey.1.PreSharedKey`);
  const radio5 = radios.find((r) => r.id.endsWith(".5"));
  assert.equal(radio5?.band, undefined);
});

test("keeping the existing WiFi key never writes a blank password", () => {
  const d = wifiFixture();
  const t = buildWifiTask(d, `${WLAN2}.SSID`, {
    ssid: "Lab2",
    enabled: true,
    passwordAction: "keep",
  });
  assert.ok(
    !t.parameterValues.some(([n]) => /Key|Passphrase|Password/i.test(n)),
  );
  assert.deepEqual(
    t.parameterValues.find(([n]) => n.endsWith(".SSID")),
    [`${WLAN2}.SSID`, "Lab2", "xsd:string"],
  );
  assert.deepEqual(
    t.parameterValues.find(([n]) => n.endsWith(".Enable")),
    [`${WLAN2}.Enable`, true, "xsd:boolean"],
  );
});

test("replacing the key writes through the writable key parameter", () => {
  const d = wifiFixture();
  const t = buildWifiTask(d, `${WLAN2}.SSID`, {
    passwordAction: "replace",
    password: "new-passphrase-123",
  });
  assert.deepEqual(t.parameterValues, [
    [
      `${WLAN2}.PreSharedKey.1.PreSharedKey`,
      "new-passphrase-123",
      "xsd:string",
    ],
  ]);
  // 64 hex is also valid.
  const hex = buildWifiTask(d, `${WLAN2}.SSID`, {
    passwordAction: "replace",
    password: "a".repeat(64),
  });
  assert.equal(hex.parameterValues.length, 1);
});

test("weak or oversized PSKs and SSIDs are rejected", () => {
  const d = wifiFixture();
  assert.throws(
    () =>
      buildWifiTask(d, `${WLAN2}.SSID`, {
        passwordAction: "replace",
        password: "short",
      }),
    { message: /8–63/ },
  );
  assert.throws(
    () =>
      buildWifiTask(d, `${WLAN2}.SSID`, {
        ssid: "x".repeat(33),
        passwordAction: "keep",
      }),
    { message: /1–32/ },
  );
});

test("unsupported security modes and missing key mappings refuse writes", () => {
  const d = wifiFixture();
  d[`${WLAN2}.BeaconType`].value[0] = "Basic"; // WEP-only
  assert.throws(
    () =>
      buildWifiTask(d, `${WLAN2}.SSID`, {
        passwordAction: "replace",
        password: "valid-length-passphrase",
      }),
    { message: /belum didukung/ },
  );
  const d2 = wifiFixture();
  delete d2[`${WLAN2}.PreSharedKey.1.PreSharedKey`];
  assert.throws(
    () =>
      buildWifiTask(d2, `${WLAN2}.SSID`, {
        passwordAction: "replace",
        password: "valid-length-passphrase",
      }),
    { message: /tidak unik\/tidak dapat ditulis/ },
  );
});

test("read-only parameters are never written", () => {
  const d = wifiFixture();
  d[`${WLAN2}.Enable`].writable = false;
  assert.throws(
    () =>
      buildWifiTask(d, `${WLAN2}.SSID`, {
        enabled: false,
        passwordAction: "keep",
      }),
    { message: /Enable tidak dapat ditulis/ },
  );
});

test("TR-181 SSID joins its AccessPoint for Enable and key", () => {
  const d = wifiFixture();
  const ssidNode = "Device.WiFi.SSID.1";
  const apNode = "Device.WiFi.AccessPoint.1";
  d[`${ssidNode}.SSID`] = { value: ["Home181", "xsd:string"], writable: true };
  d[`${apNode}.SSIDReference`] = { value: [ssidNode, "xsd:string"] };
  d[`${apNode}.Enable`] = { value: [true, "xsd:boolean"], writable: true };
  d[`${apNode}.Security.PreSharedKey.1.PreSharedKey`] = {
    value: ["", "xsd:string"],
    writable: true,
  };
  const radios = readWifi(d);
  const radio = radios.find((r) => r.id === ssidNode);
  assert.equal(radio?.enabled, true);
  assert.equal(
    radio?.keyPath,
    `${apNode}.Security.PreSharedKey.1.PreSharedKey`,
  );
});

test("TR-181 builder writes Enable and key through the joined AccessPoint", () => {
  const d = wifiFixture();
  const ssidNode = "Device.WiFi.SSID.1";
  const apNode = "Device.WiFi.AccessPoint.1";
  d[`${ssidNode}.SSID`] = { value: ["Home181", "xsd:string"], writable: true };
  d[`${apNode}.SSIDReference`] = { value: [ssidNode, "xsd:string"] };
  d[`${apNode}.Enable`] = { value: [true, "xsd:boolean"], writable: true };
  d[`${apNode}.Security.ModeEnabled`] = {
    value: ["WPA2-PSK", "xsd:string"],
    writable: false,
  };
  d[`${apNode}.Security.KeyPassphrase`] = {
    value: ["", "xsd:string"],
    writable: true,
  };
  // The builder must write the AP paths even though the input is the
  // SSID node — the old builder searched under the SSID and could
  // never write a TR-181 radio it had just rendered writable (PR #8
  // review).
  const t = buildWifiTask(d, `${ssidNode}.SSID`, {
    enabled: false,
    passwordAction: "replace",
    password: "tr181-passphrase",
  });
  assert.deepEqual(t.parameterValues, [
    [`${apNode}.Enable`, false, "xsd:boolean"],
    [`${apNode}.Security.KeyPassphrase`, "tr181-passphrase", "xsd:string"],
  ]);
  // A TR-181 SSID with NO joined AccessPoint refuses key writes.
  const orphan = wifiFixture();
  orphan[`${ssidNode}.SSID`] = {
    value: ["Orphan", "xsd:string"],
    writable: true,
  };
  assert.throws(
    () =>
      buildWifiTask(orphan, `${ssidNode}.SSID`, {
        passwordAction: "replace",
        password: "valid-length-passphrase",
      }),
    { message: /tidak unik\/tidak dapat ditulis/ },
  );
});

test("ambiguous writable keys refuse replacement instead of first match", () => {
  const d = wifiFixture();
  d[`${WLAN2}.WPAPreSharedKey`] = { value: ["", "xsd:string"], writable: true };
  assert.throws(
    () =>
      buildWifiTask(d, `${WLAN2}.SSID`, {
        passwordAction: "replace",
        password: "valid-length-passphrase",
      }),
    { message: /ambigu/ },
  );
});
