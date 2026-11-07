// WiFi model (M05-E): discovery from the parameters that actually
// exist on the device — never a hardcoded SSID-number-to-band mapping.
// TR-098 WLANConfiguration is the verified shape; TR-181 SSID entries
// render read-only unless their key mapping is unambiguous. Keep =
// never write a blank key; replace writes through the writable key
// parameter only when the security mode plausibly accepts a PSK.
import type { WanDevice } from "./wan-types.ts";

export interface WifiRadio {
  id: string;
  ssidPath: string;
  ssid: string;
  enabled: boolean;
  writable: boolean;
  band?: string;
  keyPath?: string;
}

export interface WifiSettings {
  enabled?: boolean;
  ssid?: string;
  passwordAction: "keep" | "replace";
  password?: string;
}

type FlatDevice = Record<
  string,
  { value?: [unknown, string]; writable?: boolean } | undefined
>;

function v(device: FlatDevice, path: string): unknown {
  return (device[path] as { value?: [unknown, string] } | undefined)
    ?.value?.[0];
}

const WLAN =
  /^(InternetGatewayDevice\.LANDevice\.\d+\.WLANConfiguration\.(\d+))$/;

// Key parameters that may exist for a WLANConfiguration instance; only
// a writable one makes replacement possible.
const KEY_PARAMS = [
  "PreSharedKey.1.PreSharedKey",
  "KeyPassphrase",
  "PreSharedKey",
  "WPAPreSharedKey",
] as const;

export function readWifi(device: FlatDevice): WifiRadio[] {
  const radios: WifiRadio[] = [];
  for (const key of Object.keys(device)) {
    // A radio exists where its SSID parameter exists — derived from the
    // actual parameters, with or without a bare object-node key.
    const tr098 = key.match(
      /^(InternetGatewayDevice\.LANDevice\.\d+\.WLANConfiguration\.\d+)\.SSID$/,
    );
    if (tr098) {
      const base = tr098[1];
      const ssid = v(device, `${base}.SSID`);
      const ssidWritable =
        (device[`${base}.SSID`] as { writable?: boolean } | undefined)
          ?.writable === true;
      const enableWritable =
        (device[`${base}.Enable`] as { writable?: boolean } | undefined)
          ?.writable === true;
      const keyPath = KEY_PARAMS.map((k) => `${base}.${k}`).find(
        (p) =>
          (device[p] as { writable?: boolean } | undefined)?.writable === true,
      );
      radios.push({
        id: base,
        ssidPath: `${base}.SSID`,
        ssid: typeof ssid === "string" ? ssid : "",
        enabled: [true, 1, "1", "true"].includes(
          v(device, `${base}.Enable`) as string | number | boolean,
        ),
        writable: ssidWritable || enableWritable,
        // Band comes from the device's own Radio/Standard field, never
        // from the instance number.
        band:
          typeof v(device, `${base}.Standard`) === "string"
            ? String(v(device, `${base}.Standard`))
            : undefined,
        keyPath,
      });
      continue;
    }
    // TR-181 SSID entries: read-only view unless a writable key map
    // exists on the same instance.
    const tr181 = key.match(/^(Device\.WiFi\.SSID\.\d+)\.SSID$/);
    if (tr181) {
      // Join SSID -> AccessPoint through the actual references
      // (SSIDReference or HigherLayer): Enable reads from the AP and the
      // key resolves via the AP's Security parameters — without the
      // join every TR-181 SSID read as disabled with no key path.
      const ssidNode = tr181[1];
      const apPath = findAccessPointFor(device, ssidNode);
      const enablePath = apPath ? `${apPath}.Enable` : null;
      const enabled = enablePath
        ? [true, 1, "1", "true"].includes(
            v(device, enablePath) as string | number | boolean,
          )
        : false;
      const keyPath = apPath
        ? [
            `${apPath}.Security.PreSharedKey.1.PreSharedKey`,
            `${apPath}.Security.KeyPassphrase`,
          ].find(
            (p) =>
              (device[p] as { writable?: boolean } | undefined)?.writable ===
              true,
          )
        : undefined;
      radios.push({
        id: ssidNode,
        ssidPath: key,
        ssid: String(v(device, key) ?? ""),
        enabled,
        writable:
          (device[key] as { writable?: boolean } | undefined)?.writable ===
            true ||
          (enablePath
            ? (device[enablePath] as { writable?: boolean } | undefined)
                ?.writable === true
            : false),
        keyPath,
      });
    }
  }
  return radios.sort((a, b) => a.id.localeCompare(b.id));
}

// Resolve Device.WiFi.AccessPoint.X for an SSID node through the
// actual references (either direction); null when no unique join
// exists.
function findAccessPointFor(
  device: FlatDevice,
  ssidNode: string,
): string | null {
  const matches = new Set<string>();
  for (const key of Object.keys(device)) {
    const apMatch = key.match(
      /^(Device\.WiFi\.AccessPoint\.\d+)\.SSIDReference$/,
    );
    if (apMatch) {
      const ref = v(device, key);
      if (typeof ref === "string" && ref.replace(/\.$/, "") === ssidNode)
        matches.add(apMatch[1]);
    }
  }
  if (!matches.size) {
    const higher = v(device, `${ssidNode}.HigherLayer`);
    if (typeof higher === "string") {
      const apMatch = higher.match(/^(Device\.WiFi\.AccessPoint\.\d+)/);
      if (apMatch) matches.add(apMatch[1]);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function securityAcceptsPsk(device: FlatDevice, base: string): boolean {
  // Refuse key writes on modes that cannot take a PSK. Missing mode
  // info means we cannot prove support → refuse (extensible profile,
  // not a guess).
  const mode =
    v(device, `${base}.BeaconType`) ?? v(device, `${base}.WPAEncryptionModes`);
  if (typeof mode !== "string" || !mode) return false;
  return /WPA/i.test(mode) || /11i/i.test(mode);
}

function validPsk(psk: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(psk) || (psk.length >= 8 && psk.length <= 63);
}

export interface WifiTask {
  name: "setParameterValues";
  device: string;
  parameterValues: [string, string | number | boolean, string][];
  expiry: number;
}

export function buildWifiTask(
  device: FlatDevice,
  ssidPath: string,
  settings: WifiSettings,
): WifiTask {
  const base = ssidPath.replace(/\.SSID$/, "");
  const values: [string, string | number | boolean, string][] = [];

  const ssidNode = device[`${base}.SSID`] as
    | { writable?: boolean; value?: [unknown, string] }
    | undefined;
  if (settings.ssid != null) {
    const bytes = new TextEncoder().encode(settings.ssid).length;
    if (bytes < 1 || bytes > 32) throw new Error("SSID harus 1–32 byte UTF-8.");
    if (ssidNode?.writable !== true)
      throw new Error("SSID tidak dapat ditulis pada perangkat ini.");
    values.push([
      `${base}.SSID`,
      settings.ssid,
      ssidNode?.value?.[1] ?? "xsd:string",
    ]);
  }

  const enableNode = device[`${base}.Enable`] as
    | { writable?: boolean; value?: [unknown, string] }
    | undefined;
  if (settings.enabled != null) {
    // Absent Enable parameter: nothing to write (device keeps its
    // state); present-but-read-only is a hard refusal.
    if (enableNode && enableNode.writable !== true)
      throw new Error("Enable tidak dapat ditulis pada perangkat ini.");
    if (enableNode?.writable === true)
      values.push([
        `${base}.Enable`,
        settings.enabled,
        enableNode.value?.[1] ?? "xsd:boolean",
      ]);
  }

  if (settings.passwordAction === "replace") {
    // Multiple writable key candidates on one instance = ambiguous
    // mapping: refuse rather than write the first match (spec).
    const keyCandidates = KEY_PARAMS.map((k) => `${base}.${k}`).filter(
      (p) =>
        (device[p] as { writable?: boolean } | undefined)?.writable === true,
    );
    if (keyCandidates.length > 1)
      throw new Error(
        "Mapping key WiFi ambigu (beberapa kunci writable) — tulis kunci tidak didukung.",
      );
    const keyPath = keyCandidates[0];
    if (!keyPath)
      throw new Error(
        "Mapping key WiFi tidak unik/tidak dapat ditulis pada perangkat ini.",
      );
    if (!securityAcceptsPsk(device, base))
      throw new Error(
        "Mode keamanan perangkat ini belum didukung untuk penulisan kelas kunci.",
      );
    const psk = settings.password ?? "";
    if (!validPsk(psk))
      throw new Error("Kunci WPA harus 8–63 karakter atau 64 heksadesimal.");
    const keyNode = device[keyPath] as
      | { value?: [unknown, string] }
      | undefined;
    values.push([keyPath, psk, keyNode?.value?.[1] ?? "xsd:string"]);
  }
  // "keep" never writes a blank key — no key parameter at all.

  if (!values.length)
    throw new Error("Tidak ada perubahan WiFi untuk dikirim.");

  return {
    name: "setParameterValues",
    device: String(v(device, "DeviceID.ID") ?? ""),
    parameterValues: values,
    expiry: 900,
  };
}

export type { FlatDevice };
export type { WanDevice };
