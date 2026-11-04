// WAN model ported from the frozen reference
// (docs/design/reference-wan-model.md, ui/wan-model.ts — SHA256
// eaabbd1d3704674e5bcb6dc54659d12ea947624218fca827bbe806b8ef9d56bd).
// Pure functions only: no renderer dependency, no engine import. Every
// firmware correction below is backed by reference evidence; do not
// generalise them to unverified firmware.

import type { WanDevice, WanSettings, WanTask, WanValue } from "./wan-types.ts";

export const WAN_COLLECTION =
  /^InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WAN(?:IP|PPP)Connection$/;
export const WAN_INSTANCE =
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
