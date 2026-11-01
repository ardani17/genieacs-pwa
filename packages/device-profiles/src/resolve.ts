// Profile resolver: exact vendor/model/firmware matching for the three
// VERIFIED ZTE profiles from docs/design/reference-wan-model.md. Any
// other firmware — ZTE or not — resolves to a generic TR-181 read-only
// view. WiFi write follows the writable-path proof, never the name.
import { type DeviceProfile, type FlatDeviceLike, flatValue } from "./types.ts";

const ZTE_VERIFIED: Record<
  string,
  { firmwares: string[]; wanPathRoot: string; wifiWritable: boolean }
> = {
  F609: {
    firmwares: ["V5.2.10P5T13"],
    wanPathRoot: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice",
    wifiWritable: false,
  },
  F670: {
    firmwares: ["V6.0.10P3N19", "V6.0.10P3N3"],
    wanPathRoot: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice",
    wifiWritable: true,
  },
  F660: {
    firmwares: ["V5.2.10P1T2"],
    wanPathRoot: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice",
    wifiWritable: false,
  },
};

const GENERIC_PATHS = {
  manufacturer: "DeviceID.Manufacturer",
  model: "DeviceID.ProductClass",
  firmware: "Device.DeviceInfo.SoftwareVersion",
  serial: "DeviceID.SerialNumber",
  wanIp:
    "Device.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
  wanMode:
    "Device.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionType",
  pppoeUsername:
    "Device.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
  wifiSsid: "Device.WiFi.SSID.1.SSID",
};

function str(device: FlatDeviceLike, path: string): string {
  return String(flatValue(device, path) ?? "");
}

export function resolveProfile(device: FlatDeviceLike): DeviceProfile {
  const manufacturer = str(device, "DeviceID.Manufacturer");
  const model = str(device, "DeviceID.ProductClass");
  const firmware = str(
    device,
    "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
  );

  if (/^ZTE$/i.test(manufacturer) && ZTE_VERIFIED[model]) {
    const def = ZTE_VERIFIED[model];
    const verified = def.firmwares.includes(firmware);
    return {
      id: verified
        ? `zte-${model.toLowerCase()}-${firmware}`
        : `zte-${model.toLowerCase()}-generic`,
      vendor: "zte",
      model,
      firmware: verified ? firmware : null,
      verified,
      wan: verified,
      wifiWritable: verified && def.wifiWritable,
      paths: {
        manufacturer: "DeviceID.Manufacturer",
        model: "DeviceID.ProductClass",
        firmware: "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
        serial: "DeviceID.SerialNumber",
        wanIp: `${def.wanPathRoot}.1.WANIPConnection.1.ExternalIPAddress`,
        wanMode: `${def.wanPathRoot}.1.WANPPPConnection.1.ConnectionType`,
        pppoeUsername: `${def.wanPathRoot}.1.WANPPPConnection.1.Username`,
        wifiSsid: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
      },
    };
  }

  // Generic TR-181 view (read-only) for everything else.
  return {
    id: "generic-tr181",
    vendor: "generic",
    model,
    firmware: firmware || null,
    verified: false,
    wan: false,
    wifiWritable: false,
    paths: GENERIC_PATHS,
  };
}
