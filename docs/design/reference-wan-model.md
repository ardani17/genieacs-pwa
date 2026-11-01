# Referensi patch model WAN

Snapshot dokumenter dari folder referensi, 1 November2026. Source berikut belum
dipasang pada fork. Ini bukti/rujukan migrasi, bukan instruksi menjalankan tes
terhadap deployment referensi. Password pada fixture adalah dummy test.
Pertahankan notices/lisensi GenieACS; renderer Mithril diganti React, aturan
perangkat dan hasil operasi dipertahankan sesuai feature-parity.md.

## ui/wan-model.ts

SHA256 berkas asli:
`eaabbd1d3704674e5bcb6dc54659d12ea947624218fca827bbe806b8ef9d56bd`.

```ts
export interface WanParameter {
  value?: [string | number | boolean, string];
  writable?: boolean;
}
export type WanDevice = Record<string, WanParameter>;
export interface WanSettings {
  name: string;
  mode: string;
  service: string;
  enable: boolean;
  nat: boolean;
  vlanEnable: boolean;
  vlan: string;
  priority: string;
  username: string;
  password: string;
  addressingType: string;
  ip: string;
  mask: string;
  gateway: string;
  dns: string;
  lanBind: string;
}
export type WanValue = [string, string | number | boolean, string];
export interface WanTask {
  name: "setParameterValues" | "addObject";
  device: string;
  parameterValues: WanValue[];
  objectName?: string;
  expiry: number;
  status?: string;
  _id?: string;
}

export const WAN_COLLECTION =
  /^InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WAN(?:IP|PPP)Connection$/;
const WAN_INSTANCE =
  /^(InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WAN(?:IP|PPP)Connection\.\d+)(?:\.|$)/;
export function value(
  device: WanDevice,
  path: string,
): string | number | boolean {
  return device[path]?.value?.[0];
}
export function isZteWan(device: WanDevice, collection: string): boolean {
  return (
    WAN_COLLECTION.test(collection) &&
    /ZTE/i.test(String(value(device, "DeviceID.Manufacturer") || ""))
  );
}
export function collections(device: WanDevice): string[] {
  const found = new Set<string>();
  for (const key of Object.keys(device)) {
    const match = key.match(
      /^(InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WAN(?:IP|PPP)Connection)(?:\.|$)/,
    );
    if (match) found.add(match[1]);
  }
  return [...found].sort();
}
export function connections(device: WanDevice, collection?: string): string[] {
  const found = new Set<string>();
  for (const key of Object.keys(device)) {
    const match = key.match(WAN_INSTANCE);
    if (match && (!collection || match[1].startsWith(`${collection}.`)))
      found.add(match[1]);
  }
  return [...found].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}
function f670WanIp(device: WanDevice, path: string): boolean {
  const model =
    value(device, "DeviceID.ProductClass") ||
    value(device, "InternetGatewayDevice.DeviceInfo.ModelName");
  return (
    /ZTE/i.test(String(value(device, "DeviceID.Manufacturer") || "")) &&
    model === "F670" &&
    /\.WANIPConnection(?:\.\d+)?$/.test(path)
  );
}
function correctWanIpBridge(device: WanDevice, path: string): boolean {
  const versions: Record<string, string[]> = {
    F609: ["V5.2.10P5T13"],
    F670: ["V6.0.10P3N19", "V6.0.10P3N3"],
  };
  const model = String(
    value(device, "DeviceID.ProductClass") ||
      value(device, "InternetGatewayDevice.DeviceInfo.ModelName"),
  );
  const software = String(
    value(device, "InternetGatewayDevice.DeviceInfo.SoftwareVersion"),
  );
  return (
    /ZTE/i.test(String(value(device, "DeviceID.Manufacturer") || "")) &&
    /\.WANIPConnection(?:\.\d+)?$/.test(path) &&
    versions[model]?.includes(software) === true
  );
}
export function requiredBridgeService(
  device: WanDevice,
  path: string,
  mode: string,
): string | undefined {
  // On this firmware OTHER + IP_Bridged faults with 9003; INTERNET succeeds.
  if (
    f670WanIp(device, path) &&
    value(device, "InternetGatewayDevice.DeviceInfo.SoftwareVersion") ===
      "V6.0.10P3N19" &&
    /_Bridged$/i.test(mode)
  )
    return "INTERNET";
  return undefined;
}
export function connectionModes(device: WanDevice, path: string): string[] {
  let advertised = String(
    value(device, `${path}.PossibleConnectionTypes`) || "",
  );
  const collection = path.replace(/\.\d+$/, "");
  // For a new object use capabilities from a sibling of the same collection.
  if (!advertised && WAN_COLLECTION.test(path)) {
    for (const sibling of connections(device, path)) {
      advertised = String(
        value(device, `${sibling}.PossibleConnectionTypes`) || "",
      );
      if (advertised) break;
    }
  }
  const modes = advertised.split(/[,\s]+/).filter(Boolean);
  // Verified F609/F670 firmware advertises PPPoE_Bridged on WAN IP but
  // rejects it with 9003; IP_Bridged succeeds. WAN PPP keeps its own enum.
  if (correctWanIpBridge(device, path)) {
    for (let i = 0; i < modes.length; ++i)
      if (modes[i] === "PPPoE_Bridged") modes[i] = "IP_Bridged";
  }
  const current = value(device, `${path}.ConnectionType`);
  if (current) modes.push(String(current));
  if (modes.length) return [...new Set(modes)];
  if (WAN_COLLECTION.test(path) || WAN_COLLECTION.test(collection))
    return ["IP_Routed"];
  return [];
}
export function normalizeMode(input: string, modes: string[]): string {
  let candidate = modes.find(
    (mode) => mode.toLowerCase() === input.trim().toLowerCase(),
  );
  if (/^(bridge|bridged)$/i.test(input.trim()))
    candidate = modes.find((mode) => /_Bridged$/i.test(mode));
  if (/^(route|routed)$/i.test(input.trim()))
    candidate = modes.find((mode) => mode === "IP_Routed");
  if (!candidate)
    throw new Error(
      "Conn Mode tidak didukung modem. Klik Baca WAN untuk membaca PossibleConnectionTypes.",
    );
  return candidate;
}
export function readSettings(device: WanDevice, path: string): WanSettings {
  const get = (key: string, fallback = ""): string =>
    String(value(device, `${path}.${key}`) ?? fallback);
  const flag = (key: string, fallback: boolean): boolean => {
    const current = value(device, `${path}.${key}`);
    return current == null
      ? fallback
      : [true, 1, "1", "true"].includes(current);
  };
  return {
    name: get("Name") || "INTERNET",
    mode: get("ConnectionType", "IP_Routed"),
    service: get("X_ZTE-COM_ServiceList") || "INTERNET",
    enable: flag("Enable", true),
    nat: flag("NATEnabled", true),
    vlanEnable: flag("X_ZTE-COM_VLANEnable", +get("X_ZTE-COM_VLANID", "0") > 0),
    vlan: get("X_ZTE-COM_VLANID", "0"),
    priority: get("X_ZTE-COM_8021P", "0"),
    username: get("Username"),
    password: "",
    addressingType: get("AddressingType", "DHCP"),
    ip: get("ExternalIPAddress"),
    mask: get("SubnetMask"),
    gateway: get("DefaultGateway"),
    dns: get("DNSServers"),
    lanBind: get("X_ZTE-COM_LanInterface"),
  };
}
function integer(
  input: string,
  min: number,
  max: number,
  label: string,
): number {
  if (!/^\d+$/.test(input) || +input < min || +input > max)
    throw new Error(`${label} harus ${min}–${max}.`);
  return +input;
}
function ipv4(input: string): boolean {
  return (
    /^\d+\.\d+\.\d+\.\d+$/.test(input) &&
    input.split(".").every((part) => +part <= 255)
  );
}
function subnetMask(input: string): boolean {
  if (!ipv4(input)) return false;
  const bits = input
    .split(".")
    .map((part) => (+part).toString(2).padStart(8, "0"))
    .join("");
  return /^1+0*$/.test(bits);
}
export function activeManagementWan(device: WanDevice, path: string): boolean {
  const ip = value(device, `${path}.ExternalIPAddress`);
  const requestUrl = value(
    device,
    "InternetGatewayDevice.ManagementServer.ConnectionRequestURL",
  );
  if (!ip || ip === "0.0.0.0" || !requestUrl) return false;
  try {
    return new URL(String(requestUrl)).hostname === ip;
  } catch {
    return false;
  }
}
export function buildWanTask(
  device: WanDevice,
  collection: string,
  instance: string | null,
  settings: WanSettings,
): WanTask {
  if (!isZteWan(device, collection))
    throw new Error("Editor ini untuk WAN TR-098 ZTE.");
  if (
    instance &&
    (!WAN_INSTANCE.test(instance) ||
      instance.replace(/\.\d+$/, "") !== collection)
  )
    throw new Error("Objek WAN tidak sesuai.");
  if (!instance && device[collection]?.writable !== true)
    throw new Error("Modem belum mengizinkan penambahan WAN. Klik Baca WAN.");
  if (!settings.name.trim() || settings.name.length > 64)
    throw new Error("Conn Name wajib diisi, maksimal 64 karakter.");
  const mode = normalizeMode(
    settings.mode,
    connectionModes(device, instance || collection),
  );
  const bridge = /_Bridged$/i.test(mode);
  const ppp = collection.endsWith("WANPPPConnection");
  const requestedService = settings.service.trim();
  if (!requestedService)
    throw new Error("Service List wajib diisi sebelum WAN diaktifkan.");
  if (bridge && /TR069/i.test(requestedService))
    throw new Error(
      "Bridge tidak dapat membawa layanan TR069. Gunakan INTERNET atau OTHER pada WAN bridge.",
    );
  const service =
    requiredBridgeService(device, instance || collection, mode) ||
    requestedService;
  if (bridge && settings.enable && !settings.lanBind.trim())
    throw new Error("Pilih LAN/SSID untuk WAN bridge yang aktif.");
  if (
    instance &&
    activeManagementWan(device, instance) &&
    (bridge || !settings.enable || !/TR069/i.test(service))
  ) {
    throw new Error(
      "Ini jalur ACS aktif. Pindahkan layanan TR069 ke WAN lain sebelum mengubahnya.",
    );
  }
  const vlan = settings.vlanEnable
    ? integer(settings.vlan, 1, 4094, "VLAN ID")
    : 0;
  const priority = integer(settings.priority, 0, 7, "Prioritas VLAN");
  if (ppp && !bridge && settings.enable) {
    if (!settings.username.trim())
      throw new Error("Username PPPoE wajib diisi.");
    if (
      (!instance || !value(device, `${instance}.Username`)) &&
      !settings.password
    )
      throw new Error("Password PPPoE wajib diisi untuk WAN baru.");
  }
  if (!ppp && !bridge && !["DHCP", "Static"].includes(settings.addressingType))
    throw new Error("Pilih DHCP atau Static.");
  if (!ppp && !bridge && settings.addressingType === "Static") {
    if (![settings.ip, settings.mask, settings.gateway].every(ipv4))
      throw new Error("IP, mask, dan gateway harus berupa IPv4 yang valid.");
    if (!subnetMask(settings.mask))
      throw new Error("Subnet mask harus berurutan, misalnya 255.255.255.0.");
    if (settings.dns && !settings.dns.split(",").every((v) => ipv4(v.trim())))
      throw new Error("DNS harus berupa daftar IPv4, dipisahkan koma.");
  }
  if (
    settings.lanBind &&
    settings.lanBind !== value(device, `${instance}.X_ZTE-COM_LanInterface`)
  ) {
    if (
      !settings.lanBind
        .split(",")
        .every((path) =>
          /^InternetGatewayDevice\.LANDevice\.\d+\.(LANEthernetInterfaceConfig|WLANConfiguration)\.\d+$/.test(
            path.trim(),
          ),
        )
    )
      throw new Error(
        "LAN Bind harus berisi path interface LAN/WLAN, dipisahkan koma.",
      );
  }
  const values: WanValue[] = [];
  const sample = instance || connections(device, collection)[0];
  const add = (
    name: string,
    val: string | number | boolean,
    fallbackType: string,
    optional = false,
  ): void => {
    const node = device[`${sample}.${name}`];
    if (node?.writable === false) {
      if (optional || node.value?.[0] === val) return;
      throw new Error(`${name} hanya dapat dibaca pada modem ini.`);
    }
    if (optional && !node) return;
    const type = node?.value?.[1] || fallbackType;
    let typed = val;
    if (type === "xsd:boolean") typed = [true, 1, "1", "true"].includes(val);
    values.push([instance ? `${instance}.${name}` : name, typed, type]);
  };
  add("Name", settings.name.trim(), "xsd:string");
  add("ConnectionType", mode, "xsd:string");
  add("X_ZTE-COM_ServiceList", service, "xsd:string");
  add("X_ZTE-COM_VLANEnable", settings.vlanEnable ? 1 : 0, "xsd:unsignedInt");
  add("X_ZTE-COM_VLANID", vlan, "xsd:unsignedInt");
  add("X_ZTE-COM_8021P", priority, "xsd:unsignedInt", true);
  add("NATEnabled", bridge ? false : settings.nat, "xsd:boolean");
  if (ppp && !bridge) {
    add("ConnectionTrigger", "AlwaysOn", "xsd:string", true);
    add("Username", settings.username.trim(), "xsd:string");
    if (settings.password) add("Password", settings.password, "xsd:string");
  }
  if (!ppp && !bridge) {
    add("AddressingType", settings.addressingType, "xsd:string");
    if (settings.addressingType === "Static") {
      for (const [name, val] of [
        ["ExternalIPAddress", settings.ip],
        ["SubnetMask", settings.mask],
        ["DefaultGateway", settings.gateway],
        ["DNSServers", settings.dns],
      ])
        add(name, val, "xsd:string");
    }
  }
  if (settings.lanBind || value(device, `${instance}.X_ZTE-COM_LanInterface`))
    add(
      "X_ZTE-COM_LanInterface",
      settings.lanBind
        .split(",")
        .map((x) => x.trim())
        .join(","),
      "xsd:string",
    );
  add("Enable", settings.enable, "xsd:boolean");
  return {
    name: instance ? "setParameterValues" : "addObject",
    device: String(value(device, "DeviceID.ID")),
    ...(instance ? {} : { objectName: collection }),
    parameterValues: values,
    expiry: 900,
  };
}
```

## tests/wan-model.test.cjs

SHA256 berkas asli:
`bf60108b80cf288d2c3fcbff8ed87ce943102a4e962d238c48490d4d25146f06`.

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const wan = require("/tmp/wan-model.cjs");

const root = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1";
const ip = `${root}.WANIPConnection.1`;
const ppp = `${root}.WANPPPConnection.2`;
function fixture() {
  const d = {
    "DeviceID.ID": { value: ["TEST-F670-TEST", "xsd:string"] },
    "DeviceID.Manufacturer": { value: ["ZTE", "xsd:string"] },
    [`${root}.WANIPConnection`]: { writable: true },
    [`${root}.WANPPPConnection`]: { writable: true },
  };
  for (const base of [ip, ppp]) {
    d[base] = { writable: true };
    for (const [name, value, type] of [
      ["Name", "", "xsd:string"],
      ["Enable", false, "xsd:boolean"],
      ["ConnectionType", "IP_Routed", "xsd:string"],
      ["PossibleConnectionTypes", "IP_Routed,PPPoE_Bridged", "xsd:string"],
      ["ConnectionTrigger", "AlwaysOn", "xsd:string"],
      ["X_ZTE-COM_ServiceList", "", "xsd:string"],
      ["X_ZTE-COM_VLANEnable", 0, "xsd:unsignedInt"],
      ["X_ZTE-COM_VLANID", 0, "xsd:unsignedInt"],
      ["X_ZTE-COM_8021P", 0, "xsd:unsignedInt"],
      ["NATEnabled", true, "xsd:boolean"],
      ["Username", "", "xsd:string"],
      ["Password", "", "xsd:string"],
      ["AddressingType", "DHCP", "xsd:string"],
      ["ExternalIPAddress", "0.0.0.0", "xsd:string"],
      ["SubnetMask", "0.0.0.0", "xsd:string"],
      ["DefaultGateway", "0.0.0.0", "xsd:string"],
      ["DNSServers", "", "xsd:string"],
      ["X_ZTE-COM_LanInterface", "", "xsd:string"],
    ])
      d[`${base}.${name}`] = {
        value: [value, type],
        writable: name !== "PossibleConnectionTypes",
      };
  }
  return d;
}
function settings(device, base = ppp) {
  return {
    ...wan.readSettings(device, base),
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
  const d = fixture();
  assert.equal(
    wan.normalizeMode("bridge", wan.connectionModes(d, ip)),
    "PPPoE_Bridged",
  );
  assert.throws(
    () => wan.normalizeMode("IP_Bridged", wan.connectionModes(d, ip)),
    /didukung/,
  );
});

test("corrects the F670 firmware WAN IP enum without changing WAN PPP", () => {
  const d = fixture();
  d["DeviceID.ProductClass"] = { value: ["F670", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V6.0.10P3N19", "xsd:string"],
  };
  assert.deepEqual(wan.connectionModes(d, ip), ["IP_Routed", "IP_Bridged"]);
  assert.deepEqual(wan.connectionModes(d, `${root}.WANIPConnection`), [
    "IP_Routed",
    "IP_Bridged",
  ]);
  assert.equal(
    wan.normalizeMode("bridge", wan.connectionModes(d, ppp)),
    "PPPoE_Bridged",
  );
  const s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  });
  const task = wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s);
  assert.equal(
    task.parameterValues.find(([p]) => p.endsWith(".ConnectionType"))[1],
    "IP_Bridged",
  );
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"].value[0] =
    "another-version";
  assert.equal(
    wan.normalizeMode("bridge", wan.connectionModes(d, ip)),
    "PPPoE_Bridged",
  );
});

test("keeps an actual connection mode even if absent from advertised capabilities", () => {
  const d = fixture();
  d[`${ip}.ConnectionType`].value[0] = "IP_Bridged";
  assert.ok(wan.connectionModes(d, ip).includes("IP_Bridged"));
});

test("P3N3 WAN IP bridge uses IP_Bridged while WAN PPP keeps its advertised modes", () => {
  const d = fixture();
  d["DeviceID.ProductClass"] = { value: ["F670", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V6.0.10P3N3", "xsd:string"],
  };
  assert.deepEqual(wan.connectionModes(d, ip), ["IP_Routed", "IP_Bridged"]);
  assert.equal(
    wan.normalizeMode(
      "bridge",
      wan.connectionModes(d, `${root}.WANIPConnection`),
    ),
    "IP_Bridged",
  );
  assert.equal(
    wan.normalizeMode("bridge", wan.connectionModes(d, ppp)),
    "PPPoE_Bridged",
  );
  const s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    vlan: "20",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1",
  });
  const values = Object.fromEntries(
    wan
      .buildWanTask(d, `${root}.WANIPConnection`, ip, s)
      .parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ip}.ConnectionType`], "IP_Bridged");
  assert.equal(values[`${ip}.X_ZTE-COM_VLANID`], 20);
  assert.equal(values[`${ip}.X_ZTE-COM_ServiceList`], "INTERNET");
});

test("F609 V5.2.10P5T13 creates a WAN IP bridge with VLAN1100 and SSID2", () => {
  const d = fixture();
  d["DeviceID.ProductClass"] = { value: ["F609", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V5.2.10P5T13", "xsd:string"],
  };
  assert.deepEqual(wan.connectionModes(d, `${root}.WANIPConnection`), [
    "IP_Routed",
    "IP_Bridged",
  ]);
  assert.equal(
    wan.normalizeMode("bridge", wan.connectionModes(d, ppp)),
    "PPPoE_Bridged",
  );
  const s = settings(d, ip);
  Object.assign(s, {
    name: "other",
    mode: "bridge",
    vlan: "1100",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  });
  const task = wan.buildWanTask(d, `${root}.WANIPConnection`, null, s);
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
  const d = fixture();
  d["DeviceID.ProductClass"] = { value: ["F670", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V6.0.10P3N19", "xsd:string"],
  };
  const s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    service: "OTHER",
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  });
  const task = wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s);
  assert.equal(
    task.parameterValues.find(([p]) => p.endsWith(".X_ZTE-COM_ServiceList"))[1],
    "INTERNET",
  );
  s.mode = "IP_Routed";
  assert.equal(
    wan
      .buildWanTask(d, `${root}.WANIPConnection`, ip, s)
      .parameterValues.find(([p]) => p.endsWith(".X_ZTE-COM_ServiceList"))[1],
    "OTHER",
  );
  s.mode = "bridge";
  assert.equal(
    wan
      .buildWanTask(d, `${root}.WANPPPConnection`, ppp, s)
      .parameterValues.find(([p]) => p.endsWith(".X_ZTE-COM_ServiceList"))[1],
    "OTHER",
  );
  s.service = "TR069";
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s),
    /TR069/,
  );
});
test("supports a modem that actually advertises IP_Bridged", () => {
  const d = fixture();
  d[`${ip}.PossibleConnectionTypes`].value[0] = "IP_Routed,IP_Bridged";
  assert.equal(
    wan.normalizeMode("bridge", wan.connectionModes(d, ip)),
    "IP_Bridged",
  );
});
test("does not invent bridge support when the modem has not reported it", () => {
  const d = fixture();
  delete d[`${ip}.PossibleConnectionTypes`];
  assert.throws(
    () => wan.normalizeMode("bridge", wan.connectionModes(d, ip)),
    /didukung/,
  );
});
test("builds one complete typed PPPoE task", () => {
  const d = fixture(),
    task = wan.buildWanTask(d, `${root}.WANPPPConnection`, ppp, settings(d));
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
  const d = fixture(),
    task = wan.buildWanTask(d, `${root}.WANPPPConnection`, null, settings(d));
  assert.equal(task.name, "addObject");
  assert.equal(task.objectName, `${root}.WANPPPConnection`);
  assert.ok(task.parameterValues.every(([p]) => !p.includes(".")));
});
test("preserves the existing password when the password field is blank", () => {
  const d = fixture();
  d[`${ppp}.Username`].value[0] = "existing-user";
  const s = settings(d);
  s.password = "";
  const task = wan.buildWanTask(d, `${root}.WANPPPConnection`, ppp, s);
  assert.ok(!task.parameterValues.some(([p]) => p.endsWith(".Password")));
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANPPPConnection`, null, s),
    /password/i,
  );
});
test("requires credentials for an unconfigured existing PPP object", () => {
  const d = fixture(),
    s = settings(d);
  s.password = "";
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANPPPConnection`, ppp, s),
    /password/i,
  );
});
test("bridge sends a compatible mode, service, and disabled NAT together", () => {
  const d = fixture(),
    s = settings(d, ip);
  Object.assign(s, {
    mode: "bridge",
    service: "OTHER",
    lanBind: "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1",
  });
  const task = wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s);
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
  const d = fixture(),
    s = settings(d, ip);
  Object.assign(s, { mode: "bridge", service: "VoIP_TR069" });
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s),
    /TR069/,
  );
});
test("rejects missing bindings for an enabled bridge", () => {
  const d = fixture(),
    s = settings(d, ip);
  Object.assign(s, { mode: "bridge", service: "OTHER", lanBind: "" });
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s),
    /LAN/,
  );
});
test("validates VLAN, priority, and static IPv4 settings before enqueue", () => {
  const d = fixture(),
    s = settings(d);
  s.vlan = "4095";
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANPPPConnection`, ppp, s),
    /VLAN/,
  );
  s.vlan = "1000";
  s.priority = "8";
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANPPPConnection`, ppp, s),
    /prioritas/i,
  );
  Object.assign(s, {
    priority: "0",
    addressingType: "Static",
    ip: "300.1.2.3",
    mask: "255.255.255.0",
    gateway: "192.168.1.1",
  });
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s),
    /IPv4/,
  );
});
test("protects the actual active ACS interface from an accidental bridge conversion", () => {
  const d = fixture(),
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
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s),
    /ACS aktif/,
  );
});
test("rejects a non-contiguous static subnet mask", () => {
  const d = fixture(),
    s = settings(d, ip);
  Object.assign(s, {
    addressingType: "Static",
    ip: "192.168.1.2",
    gateway: "192.168.1.1",
    mask: "255.0.255.0",
  });
  assert.throws(
    () => wan.buildWanTask(d, `${root}.WANIPConnection`, ip, s),
    /Subnet mask/,
  );
});
test("uses numeric vendor flags when an older ZTE omits cached value types", () => {
  const d = fixture();
  d[`${ppp}.X_ZTE-COM_VLANEnable`] = { writable: true };
  const task = wan.buildWanTask(
    d,
    `${root}.WANPPPConnection`,
    ppp,
    settings(d),
  );
  assert.deepEqual(
    task.parameterValues
      .find(([path]) => path.endsWith(".X_ZTE-COM_VLANEnable"))
      .slice(1),
    [1, "xsd:unsignedInt"],
  );
});
test("preserves an existing tagged VLAN when the modem omits VLANEnable", () => {
  const d = fixture();
  d[`${ip}.X_ZTE-COM_VLANEnable`] = { writable: true };
  d[`${ip}.X_ZTE-COM_VLANID`].value[0] = 100;
  const s = wan.readSettings(d, ip);
  assert.equal(s.vlanEnable, true);
  assert.equal(s.vlan, "100");
});
```
