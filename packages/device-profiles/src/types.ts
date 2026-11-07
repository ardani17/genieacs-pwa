// Device profile model: verified profiles are backed by reference
// evidence (docs/design/reference-wan-model.md); anything else gets a
// GENERIC read-only view. Write capabilities follow the writable path
// proof, never the vendor name alone.

export interface DeviceProfilePaths {
  manufacturer: string;
  model: string;
  firmware: string;
  serial: string;
  wanIp: string;
  wanMode: string;
  pppoeUsername: string;
  wifiSsid: string;
}

export interface DeviceProfile {
  id: string;
  vendor: "zte" | "generic";
  model: string;
  firmware: string | null;
  verified: boolean;
  wan: boolean;
  wifiWritable: boolean;
  paths: DeviceProfilePaths;
}

export type FlatDeviceLike = Record<
  string,
  { value?: [unknown, string] } | unknown
>;

export function flatValue(device: FlatDeviceLike, path: string): unknown {
  const entry = device[path] as { value?: [unknown, string] } | undefined;
  return entry?.value?.[0];
}
