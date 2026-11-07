import test from "node:test";
import assert from "node:assert/strict";
import { resolveProfile } from "./resolve.ts";

const ZTE_BASE = {
  "DeviceID.Manufacturer": { value: ["ZTE", "xsd:string"] },
  "DeviceID.ProductClass": { value: ["F670", "xsd:string"] },
  "InternetGatewayDevice.DeviceInfo.SoftwareVersion": {
    value: ["unknown", "xsd:string"],
  },
};

void test("unknown firmware is not a verified writable WAN profile", () => {
  const p = resolveProfile({
    "DeviceID.Manufacturer": { value: ["ZTE", "xsd:string"] },
    "DeviceID.ProductClass": { value: ["F670", "xsd:string"] },
    "InternetGatewayDevice.DeviceInfo.SoftwareVersion": {
      value: ["unknown", "xsd:string"],
    },
  });
  assert.equal(p.verified, false);
  assert.equal(p.wan, false);
});

void test("exact verified firmware unlocks WAN (+WiFi write only where proven)", () => {
  const f670 = resolveProfile({
    ...ZTE_BASE,
    "InternetGatewayDevice.DeviceInfo.SoftwareVersion": {
      value: ["V6.0.10P3N19", "xsd:string"],
    },
  });
  assert.equal(f670.verified, true);
  assert.equal(f670.wan, true);
  assert.equal(f670.wifiWritable, true);

  const f609 = resolveProfile({
    "DeviceID.Manufacturer": { value: ["ZTE", "xsd:string"] },
    "DeviceID.ProductClass": { value: ["F609", "xsd:string"] },
    "InternetGatewayDevice.DeviceInfo.SoftwareVersion": {
      value: ["V5.2.10P5T13", "xsd:string"],
    },
  });
  assert.equal(f609.verified, true);
  assert.equal(f609.wifiWritable, false);

  const otherFirmware = resolveProfile({
    "DeviceID.Manufacturer": { value: ["ZTE", "xsd:string"] },
    "DeviceID.ProductClass": { value: ["F670", "xsd:string"] },
    "InternetGatewayDevice.DeviceInfo.SoftwareVersion": {
      value: ["V9.9.9-unknown", "xsd:string"],
    },
  });
  assert.equal(otherFirmware.verified, false);
  assert.equal(otherFirmware.wan, false);
});

void test("other vendors fall back to a generic read-only TR-181 view", () => {
  for (const [manufacturer, model] of [
    ["Huawei", "HG8245H"],
    ["FiberHome", "HG6245D"],
    ["SomeVendor", "TR181-Device"],
  ] as const) {
    const p = resolveProfile({
      "DeviceID.Manufacturer": { value: [manufacturer, "xsd:string"] },
      "DeviceID.ProductClass": { value: [model, "xsd:string"] },
    });
    assert.equal(p.verified, false);
    assert.equal(p.wan, false);
    assert.equal(p.wifiWritable, false);
    assert.equal(p.vendor, "generic");
    assert.equal(p.paths.wifiSsid, "Device.WiFi.SSID.1.SSID");
  }
});
