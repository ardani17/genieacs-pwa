// Saved installation settings contract (docs/design/contracts.md
// "Konfigurasi dan kontrol VPN", M07-A): the persistent VPN/ACS profile
// DTO validated identically on both sides of the BFF boundary. Pure TS —
// no Node APIs — because the browser bundle and the engine share this
// module. Secrets never appear in these shapes: the view exposes only
// `passwordConfigured`, and the encrypted blob (`EncryptedSecret`) is a
// storage detail owned by lib/ui/app-settings.ts.

import { isRecord, vEnum, type FieldErrors } from "./validators.ts";

export interface AcsAddress {
  mode: "manual" | "auto-ppp";
  scheme: "http" | "https";
  host: string | null;
  port: number;
  path: string;
}

export interface VpnProfileInput {
  revision: number;
  server: string;
  username: string;
  passwordAction: "keep" | "replace";
  password?: string;
  routes: string[];
  mtu: number;
  acs: AcsAddress;
}

export interface VpnProfileView {
  revision: number;
  server: string;
  username: string;
  passwordConfigured: boolean;
  routes: string[];
  mtu: number;
  acs: AcsAddress;
  updatedAt: string; // ISO UTC
}

// AES-256-GCM secretbox persisted inside the app_settings document.
// Every component is lowercase hex; `keyId` identifies the encrypting
// key (derived, never the key itself) so a rotated key is detectable
// without decrypting.
export interface EncryptedSecret {
  iv: string;
  ciphertext: string;
  tag: string;
  keyId: string;
}

export const SETTINGS_LIMITS = {
  routesMax: 32,
  mtuMin: 576,
  mtuMax: 1500,
  mtuDefault: 1400,
  serverMax: 253,
  usernameMax: 128,
  passwordMax: 128,
  acsPathMax: 128,
  acsPortDefault: 7547,
} as const;

export type SettingsValidation =
  | { ok: true; value: VpnProfileInput }
  | { ok: false; fieldErrors: FieldErrors };

// --- leaf validators -------------------------------------------------------

const IPV4_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])";
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
// IPv4 CIDR with no leading zeros anywhere ("strict"): octets 0-255,
// prefix 0-32. The default route 0.0.0.0/0 is additionally rejected by
// the caller — it is a controller-routing decision, not a profile value.
const IPV4_CIDR_RE = new RegExp(
  `^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}\\/(3[0-2]|[12]?[0-9])$`,
);
const DNS_LABEL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const ACS_PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/;

export function isIPv4String(value: string): boolean {
  return IPV4_RE.test(value);
}

export function isDnsHostname(value: string): boolean {
  if (value.length === 0 || value.length > SETTINGS_LIMITS.serverMax)
    return false;
  return value.split(".").every((label) => {
    if (label.length === 0 || label.length > 63) return false;
    return DNS_LABEL_RE.test(label);
  });
}

// IPv6 literal without brackets. Uses the URL parser (browser-safe) as
// the authority: a literal is valid exactly when it survives a
// round-trip through `new URL` as the host of a bracketed URL.
export function isIPv6String(value: string): boolean {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    const url = new URL(`http://[${value}]/`);
    return url.hostname.startsWith("[") && url.hostname.endsWith("]");
  } catch {
    return false;
  }
}

// ACS host: IPv4, IPv6 or DNS hostname. Userinfo/query/fragment can only
// arrive as characters the URL round-trip rejects, but the explicit
// character guard keeps the failure mode a validation error instead of a
// parser quirk.
export function isAcsHost(value: string): boolean {
  if (value.length === 0 || value.length > SETTINGS_LIMITS.serverMax)
    return false;
  if (/[@/?#\\]/.test(value)) return false;
  if (value.includes(":")) return isIPv6String(value);
  return isIPv4String(value) || isDnsHostname(value);
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const KNOWN_INPUT_KEYS = new Set([
  "revision",
  "server",
  "username",
  "passwordAction",
  "password",
  "routes",
  "mtu",
  "acs",
]);

const KNOWN_ACS_KEYS = new Set(["mode", "scheme", "host", "port", "path"]);

function validateAcs(raw: unknown, errors: FieldErrors): AcsAddress | null {
  if (!isRecord(raw)) {
    errors["acs"] = "must be an object";
    return null;
  }
  for (const key of Object.keys(raw))
    if (!KNOWN_ACS_KEYS.has(key)) {
      errors[`acs.${key}`] = "unknown field";
      return null;
    }

  const mode = vEnum(["manual", "auto-ppp"])(raw.mode, "acs.mode", errors);
  const scheme = vEnum(["http", "https"])(raw.scheme, "acs.scheme", errors);
  if (mode === undefined || scheme === undefined) return null;

  let host: string | null = null;
  if (mode === "manual") {
    if (typeof raw.host !== "string" || !isAcsHost(raw.host)) {
      errors["acs.host"] =
        "must be an IPv4, IPv6 or DNS host without userinfo/query/fragment";
      return null;
    }
    host = raw.host;
  } else if (raw.host !== undefined && raw.host !== null) {
    errors["acs.host"] = "must be null in auto-ppp mode";
    return null;
  }

  const port = raw.port;
  if (
    typeof port !== "number" ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    errors["acs.port"] = "must be an integer between 1 and 65535";
    return null;
  }

  const path = raw.path;
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.length > SETTINGS_LIMITS.acsPathMax ||
    !ACS_PATH_RE.test(path) ||
    hasControlChar(path)
  ) {
    errors["acs.path"] = 'must be an absolute path like "/" without ? or #';
    return null;
  }

  return { mode, scheme, host, port, path };
}

/**
 * Strict validation of the saved-settings PUT body. Unknown keys,
 * coercions, control characters (newline/NUL injection into rendered
 * xl2tpd/pppd config), oversized route lists and the default route are
 * all rejected with per-field errors for ApiResult.error.fieldErrors.
 */
export function validateVpnProfileInput(raw: unknown): SettingsValidation {
  const errors: FieldErrors = Object.create(null);
  if (!isRecord(raw)) {
    errors[""] = "must be an object";
    return { ok: false, fieldErrors: errors };
  }
  for (const key of Object.keys(raw))
    if (!KNOWN_INPUT_KEYS.has(key)) {
      errors[key] = "unknown field";
      return { ok: false, fieldErrors: errors };
    }

  let revision: number | undefined;
  if (
    typeof raw.revision === "number" &&
    Number.isSafeInteger(raw.revision) &&
    raw.revision >= 0 &&
    raw.revision < Number.MAX_SAFE_INTEGER
  ) {
    revision = raw.revision;
  } else {
    errors["revision"] = "must be a non-negative integer";
  }

  let server: string | undefined;
  if (typeof raw.server === "string" && serverOk(raw.server)) {
    server = raw.server;
  } else {
    errors["server"] = "must be an IPv4 address or DNS hostname";
  }

  let username: string | undefined;
  if (
    typeof raw.username === "string" &&
    raw.username.length > 0 &&
    raw.username.length <= SETTINGS_LIMITS.usernameMax &&
    !hasControlChar(raw.username)
  ) {
    username = raw.username;
  } else {
    errors["username"] =
      `must be 1-${SETTINGS_LIMITS.usernameMax} characters without control characters`;
  }

  const passwordAction = vEnum(["keep", "replace"])(
    raw.passwordAction,
    "passwordAction",
    errors,
  );

  let password: string | undefined;
  if (passwordAction === "keep") {
    if (raw.password !== undefined) {
      errors["password"] = "must be omitted when passwordAction is keep";
    }
  } else if (passwordAction === "replace") {
    if (
      typeof raw.password === "string" &&
      raw.password.length > 0 &&
      raw.password.length <= SETTINGS_LIMITS.passwordMax &&
      !hasControlChar(raw.password)
    ) {
      password = raw.password;
    } else {
      errors["password"] =
        `must be 1-${SETTINGS_LIMITS.passwordMax} characters without control characters`;
    }
  }

  let routes: string[] | undefined;
  if (Array.isArray(raw.routes)) {
    if (raw.routes.length <= SETTINGS_LIMITS.routesMax) {
      const seen = new Set<string>();
      let valid = true;
      raw.routes.forEach((route, index) => {
        if (typeof route !== "string" || !IPV4_CIDR_RE.test(route)) {
          errors[`routes.${index}`] = "must be an IPv4 CIDR like 10.0.0.0/24";
          valid = false;
          return;
        }
        if (route.endsWith("/0")) {
          errors[`routes.${index}`] = "default route 0.0.0.0/0 is not allowed";
          valid = false;
          return;
        }
        if (seen.has(route)) {
          errors[`routes.${index}`] = "duplicate route";
          valid = false;
          return;
        }
        seen.add(route);
      });
      if (valid) routes = raw.routes as string[];
    } else {
      errors["routes"] =
        `must contain at most ${SETTINGS_LIMITS.routesMax} routes`;
    }
  } else {
    errors["routes"] = "must be an array of IPv4 CIDR strings";
  }

  let mtu: number | undefined;
  if (
    typeof raw.mtu === "number" &&
    Number.isSafeInteger(raw.mtu) &&
    raw.mtu >= SETTINGS_LIMITS.mtuMin &&
    raw.mtu <= SETTINGS_LIMITS.mtuMax
  ) {
    mtu = raw.mtu;
  } else {
    errors["mtu"] =
      `must be an integer between ${SETTINGS_LIMITS.mtuMin} and ${SETTINGS_LIMITS.mtuMax}`;
  }

  const acs = validateAcs(raw.acs, errors);

  if (
    Object.keys(errors).length > 0 ||
    revision === undefined ||
    server === undefined ||
    username === undefined ||
    passwordAction === undefined ||
    routes === undefined ||
    mtu === undefined ||
    acs === null
  ) {
    if (Object.keys(errors).length === 0) errors[""] = "invalid profile";
    return { ok: false, fieldErrors: errors };
  }

  return {
    ok: true,
    value: {
      revision,
      server,
      username,
      passwordAction,
      ...(password === undefined ? {} : { password }),
      routes,
      mtu,
      acs,
    },
  };
}

function serverOk(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= SETTINGS_LIMITS.serverMax &&
    !hasControlChar(value) &&
    (isIPv4String(value) || isDnsHostname(value))
  );
}

// Defensive read guard for a persisted EncryptedSecret: a document that
// fails this is corruption, not a user error — the store turns it into
// STORAGE_ERROR instead of attempting to decrypt garbage.
export function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  if (!isRecord(value)) return false;
  const hex = /^[0-9a-f]+$/;
  return (
    typeof value.iv === "string" &&
    value.iv.length === 24 && // 12-byte GCM IV
    hex.test(value.iv) &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length > 0 &&
    value.ciphertext.length % 2 === 0 &&
    hex.test(value.ciphertext) &&
    typeof value.tag === "string" &&
    value.tag.length === 32 && // 16-byte GCM tag
    hex.test(value.tag) &&
    typeof value.keyId === "string" &&
    value.keyId.length === 16 &&
    hex.test(value.keyId)
  );
}
