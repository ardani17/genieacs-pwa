// Persistent installation settings (M07-A, contracts.md "Konfigurasi dan
// kontrol VPN"): the `app_settings` singleton document, revision CAS and
// the AES-256-GCM secretbox for the VPN password.
//
// Invariants (ADR-0009 + contracts):
// - Bootstrap from .env happens ONLY when the singleton does not exist;
//   after that, saved values win over later env changes on restart.
// - Persist first, apply later: a successful save keeps the NEW desired
//   profile even when applying it later fails. There is no automatic
//   rollback to an older profile.
// - A missing key, a key mismatch or a failed decrypt is STORAGE_ERROR —
//   never an overwrite of the stored profile and never a .env fallback.
// - Readback never exposes the secret, only `passwordConfigured`.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync, promises as fsPromises } from "node:fs";
import type { Collection } from "mongodb";
import {
  isEncryptedSecret,
  validateVpnProfileInput,
  SETTINGS_LIMITS,
} from "../../packages/app-contracts/src/settings.ts";
import type {
  AcsAddress,
  EncryptedSecret,
  VpnProfileInput,
  VpnProfileView,
} from "../../packages/app-contracts/src/settings.ts";
import { collections } from "../db/db.ts";

export const APP_SETTINGS_ID = "installation";
export const APP_SETTINGS_COLLECTION = "app_settings";

export type SettingsErrorCode =
  | "STORAGE_ERROR"
  | "VALIDATION"
  | "CONFLICT"
  | "UNCONFIGURED"
  | "INTERNAL";

export class SettingsError extends Error {
  readonly code: SettingsErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: SettingsErrorCode,
    message: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(`${code}: ${message}`);
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.name = "SettingsError";
  }
}

// ---------------------------------------------------------------------------
// AES-256-GCM secretbox

const IV_BYTES = 12;
export const SETTINGS_KEY_BYTES = 32;

function assertKeyLength(key: Buffer): void {
  if (key.length !== SETTINGS_KEY_BYTES)
    throw new SettingsError(
      "STORAGE_ERROR",
      `encryption key must be ${SETTINGS_KEY_BYTES} bytes`,
    );
}

/** Stable, non-reversible identifier for an encryption key. */
export function computeKeyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function encryptSecret(secret: string, key: Buffer): EncryptedSecret {
  assertKeyLength(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    keyId: computeKeyId(key),
  };
}

export function decryptSecret(box: EncryptedSecret, key: Buffer): string {
  assertKeyLength(key);
  if (!isEncryptedSecret(box))
    throw new SettingsError("STORAGE_ERROR", "corrupt encrypted secret");
  if (box.keyId !== computeKeyId(key))
    throw new SettingsError(
      "STORAGE_ERROR",
      "secret was encrypted with a different key",
    );
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(box.iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(box.tag, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(box.ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SettingsError("STORAGE_ERROR", "secret authentication failed");
  }
}

// ---------------------------------------------------------------------------
// Document and store

export interface AppSettingsDoc {
  _id: typeof APP_SETTINGS_ID;
  schemaVersion: 1;
  revision: number;
  installationId: string;
  profile: {
    server: string;
    username: string;
    secret: EncryptedSecret | null;
  };
  routes: string[];
  mtu: number;
  acs: AcsAddress;
  updatedAt: string; // ISO UTC
  updatedBy: string | null;
}

export interface AppSettingsDeps {
  collection: Collection<AppSettingsDoc>;
  /** The decryption key; null when none is configured (secret ops fail). */
  key: Buffer | null;
  now?: () => Date;
  uuid?: () => string;
  /** Password file reader for .env bootstrap (injectable for tests). */
  readFile?: (path: string) => Promise<string>;
}

export type AppSettingsStatus =
  | { status: "unconfigured" }
  | { status: "configured"; view: VpnProfileView };

export type SettingsApplyState =
  | "unconfigured"
  | "pending"
  | "applying"
  | "applied"
  | "failed";

export interface DecryptedProfile {
  revision: number;
  installationId: string;
  server: string;
  username: string;
  password: string | null;
  routes: string[];
  mtu: number;
}

/** The store owns its collection on the shared Mongo pool. */
export function appSettingsCollection(): Collection<AppSettingsDoc> {
  if (collections.appSettings == null)
    throw new SettingsError("INTERNAL", "database not connected");
  return collections.appSettings;
}

function isIsoUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function docToView(doc: AppSettingsDoc): VpnProfileView {
  return {
    revision: doc.revision,
    server: doc.profile.server,
    username: doc.profile.username,
    passwordConfigured: doc.profile.secret != null,
    routes: doc.routes,
    mtu: doc.mtu,
    acs: doc.acs,
    updatedAt: doc.updatedAt,
  };
}

/** Authenticate the stored ciphertext before every read or write. Read paths fail
 * STORAGE_ERROR instead of silently serving a profile whose secret could
 * never be recovered. */
function checkSecretReadable(doc: AppSettingsDoc, key: Buffer | null): void {
  const valid =
    doc?.schemaVersion === 1 &&
    Number.isSafeInteger(doc.revision) &&
    doc.revision > 0 &&
    doc.revision < Number.MAX_SAFE_INTEGER &&
    isIsoUuid(doc.installationId) &&
    doc.profile &&
    validateVpnProfileInput({
      revision: doc.revision,
      server: doc.profile.server,
      username: doc.profile.username,
      passwordAction: "replace",
      password: "validation-only",
      routes: doc.routes,
      mtu: doc.mtu,
      acs: doc.acs,
    }).ok;
  if (!valid)
    throw new SettingsError("STORAGE_ERROR", "invalid stored settings");
  const secret = doc.profile.secret;
  if (secret == null) return;
  if (key == null)
    throw new SettingsError(
      "STORAGE_ERROR",
      "encryption key not configured for a stored secret",
    );
  decryptSecret(secret, key);
}

export async function getSettingsView(
  deps: AppSettingsDeps,
): Promise<AppSettingsStatus> {
  const doc = await deps.collection.findOne({ _id: APP_SETTINGS_ID });
  if (!doc) return { status: "unconfigured" };
  checkSecretReadable(doc, deps.key);
  return { status: "configured", view: docToView(doc) };
}

export interface UpdateSettingsResult {
  view: VpnProfileView;
  /** The revision this update replaced (audit "revision sebelum/sesudah"). */
  revisionBefore: number;
  desiredRevision: number;
  /** M07-A has no controller yet: every saved profile is pending apply. */
  applyState: SettingsApplyState;
}

export async function updateSettings(
  deps: AppSettingsDeps,
  input: VpnProfileInput,
  opts: { actor?: string } = {},
): Promise<UpdateSettingsResult> {
  const validation = validateVpnProfileInput(input);
  if (validation.ok === false)
    throw new SettingsError(
      "VALIDATION",
      "invalid profile",
      validation.fieldErrors,
    );

  const current = await deps.collection.findOne({ _id: APP_SETTINGS_ID });

  // A stored secret that the mounted key can no longer decrypt must stop
  // EVERY write (keep AND replace): silently re-encrypting under a wrong
  // key would destroy the only copy. STORAGE_ERROR, no overwrite.
  if (current) checkSecretReadable(current, deps.key);

  if (input.passwordAction === "keep") {
    if (current?.profile.secret == null)
      throw new SettingsError("VALIDATION", "no stored secret to keep", {
        password: "no stored secret to keep",
      });
  }
  const secret =
    input.passwordAction === "replace"
      ? encryptSecret(input.password ?? "", requireKey(deps))
      : undefined;

  const now = (deps.now ?? (() => new Date()))().toISOString();
  const profile: AppSettingsDoc["profile"] = {
    server: input.server,
    username: input.username,
    secret: secret === undefined ? (current?.profile.secret ?? null) : secret,
  };
  const base = {
    schemaVersion: 1 as const,
    profile,
    routes: input.routes,
    mtu: input.mtu,
    acs: input.acs,
    updatedAt: now,
    updatedBy: opts.actor ?? null,
  };
  const $set: Partial<AppSettingsDoc> = base;

  let updated: WithId<AppSettingsDoc> | null;
  if (current == null) {
    // First save: revision 0 in the request means "no document yet".
    if (input.revision !== 0)
      throw new SettingsError(
        "CONFLICT",
        `settings are unconfigured; send revision 0`,
      );
    const doc: AppSettingsDoc = {
      ...base,
      _id: APP_SETTINGS_ID,
      revision: 1,
      installationId: (deps.uuid ?? randomUUID)(),
    };
    try {
      await deps.collection.insertOne(doc);
      updated = doc;
    } catch (err) {
      if (isDuplicateKeyError(err))
        throw new SettingsError(
          "CONFLICT",
          "settings already exist (concurrent save won)",
        );
      throw err;
    }
  } else {
    const result = await deps.collection.findOneAndUpdate(
      { _id: APP_SETTINGS_ID, revision: input.revision },
      { $set: { ...$set, revision: input.revision + 1 } },
      { returnDocument: "after", includeResultMetadata: true },
    );
    updated = result.value ?? null;
    if (updated == null)
      throw new SettingsError(
        "CONFLICT",
        `revision ${input.revision} is stale`,
      );
  }

  const view = docToView(updated as AppSettingsDoc);
  return {
    view,
    revisionBefore: current?.revision ?? 0,
    desiredRevision: view.revision,
    applyState: "pending",
  };
}

function requireKey(deps: AppSettingsDeps): Buffer {
  if (deps.key == null)
    throw new SettingsError(
      "STORAGE_ERROR",
      "encryption key not configured; cannot store a secret",
    );
  return deps.key;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

type WithId<T> = T & { _id: unknown };

// ---------------------------------------------------------------------------
// .env bootstrap and reset

export interface BootstrapEnv {
  VPN_SERVER?: string;
  VPN_USERNAME?: string;
  VPN_PASSWORD_FILE?: string;
  VPN_ROUTES?: string;
  VPN_MTU?: string;
  ACS_HOST?: string;
  ACS_PORT?: string;
  ACS_SCHEME?: string;
  ACS_PATH?: string;
  INSTALLATION_ID?: string;
}

/** Parse + validate the deployment (.env) candidate. Throws VALIDATION
 * with field errors — the caller decides whether that is fatal (reset)
 * or surfaced-and-skipped (bootstrap). */
export async function settingsCandidateFromEnv(
  env: BootstrapEnv,
  deps: Pick<AppSettingsDeps, "readFile" | "uuid">,
): Promise<{
  profile: { server: string; username: string; secret: EncryptedSecret | null };
  routes: string[];
  mtu: number;
  acs: AcsAddress;
  installationId: string;
  password: string | null;
}> {
  const readFile = deps.readFile ?? fsPromises.readFile;

  const server = env.VPN_SERVER;
  if (env.INSTALLATION_ID && !isIsoUuid(env.INSTALLATION_ID))
    throw new SettingsError("VALIDATION", "INSTALLATION_ID must be a UUID");
  const username = env.VPN_USERNAME;
  let password: string | null = null;
  if (env.VPN_PASSWORD_FILE) {
    try {
      password = String(await readFile(env.VPN_PASSWORD_FILE)).replace(
        /\r?\n$/,
        "",
      );
    } catch (err) {
      throw new SettingsError("VALIDATION", "cannot read VPN_PASSWORD_FILE", {
        password: "password file unreadable",
      });
    }
    if (password.length === 0)
      throw new SettingsError("VALIDATION", "VPN_PASSWORD_FILE is empty", {
        password: "password file is empty",
      });
  }

  if (password == null)
    throw new SettingsError(
      "VALIDATION",
      "bootstrap requires a password file",
      {
        password: "VPN_PASSWORD_FILE is required",
      },
    );
  if (env.ACS_SCHEME && !["http", "https"].includes(env.ACS_SCHEME))
    throw new SettingsError("VALIDATION", "invalid ACS_SCHEME");

  const routes = (env.VPN_ROUTES ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  const mtu = env.VPN_MTU ? Number(env.VPN_MTU) : SETTINGS_LIMITS.mtuDefault;

  const acsHost = env.ACS_HOST?.trim() ?? "";
  const acs: AcsAddress = acsHost
    ? {
        mode: "manual",
        scheme: env.ACS_SCHEME === "https" ? "https" : "http",
        host: acsHost,
        port: env.ACS_PORT
          ? Number(env.ACS_PORT)
          : SETTINGS_LIMITS.acsPortDefault,
        path: env.ACS_PATH || "/",
      }
    : {
        mode: "auto-ppp",
        scheme: env.ACS_SCHEME === "https" ? "https" : "http",
        host: null,
        port: env.ACS_PORT
          ? Number(env.ACS_PORT)
          : SETTINGS_LIMITS.acsPortDefault,
        path: env.ACS_PATH || "/",
      };

  // Route the candidate through the same strict DTO validation as UI
  // saves, so .env and UI profiles can never diverge in shape.
  const validation = validateVpnProfileInput({
    revision: 0,
    server: server ?? "",
    username: username ?? "",
    passwordAction: password == null ? "keep" : "replace",
    ...(password == null ? {} : { password }),
    routes,
    mtu,
    acs,
  });
  if (validation.ok === false)
    throw new SettingsError(
      "VALIDATION",
      "deployment settings are invalid",
      validation.fieldErrors,
    );

  return {
    profile: {
      server: validation.value.server,
      username: validation.value.username,
      secret: null, // assigned by the caller once a key is available
    },
    routes: validation.value.routes,
    mtu: validation.value.mtu,
    acs: validation.value.acs,
    installationId: isIsoUuid(env.INSTALLATION_ID)
      ? env.INSTALLATION_ID
      : (deps.uuid ?? randomUUID)(),
    password,
  };
}

export interface BootstrapResult {
  created: boolean;
  error?: SettingsError;
}

/** Create the singleton from deployment env — ONLY when it is missing.
 * Saved UI values always win afterwards (restart never falls back). */
export async function bootstrapSettings(
  deps: AppSettingsDeps,
  env: BootstrapEnv,
): Promise<BootstrapResult> {
  const existing = await deps.collection.findOne({ _id: APP_SETTINGS_ID });
  if (existing) return { created: false };

  let candidate;
  try {
    candidate = await settingsCandidateFromEnv(env, deps);
  } catch (err) {
    const error =
      err instanceof SettingsError
        ? err
        : new SettingsError("INTERNAL", (err as Error).message);
    // Invalid deployment config: do not create, do not delete, surface it.
    return { created: false, error };
  }

  const secret =
    candidate.password == null
      ? null
      : encryptSecret(candidate.password, requireKey(deps));

  try {
    await deps.collection.insertOne({
      _id: APP_SETTINGS_ID,
      schemaVersion: 1,
      revision: 1,
      installationId: candidate.installationId,
      profile: { ...candidate.profile, secret },
      routes: candidate.routes,
      mtu: candidate.mtu,
      acs: candidate.acs,
      updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      updatedBy: null,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return { created: false };
    throw err;
  }
  return { created: true };
}

export interface ResetBootstrapInput {
  revision: number;
  confirm: string;
}

/** Explicit reset to the deployment (.env) configuration. Requires the
 * literal confirmation and the current revision; the candidate is
 * validated BEFORE the CAS write, and any failure keeps the stored
 * profile untouched. */
export async function resetBootstrap(
  deps: AppSettingsDeps,
  input: ResetBootstrapInput,
  env: BootstrapEnv,
  opts: { actor?: string } = {},
): Promise<UpdateSettingsResult> {
  if (input.confirm !== "RESET")
    throw new SettingsError("VALIDATION", 'confirmation must be "RESET"', {
      confirm: 'must be the literal string "RESET"',
    });

  const candidate = await settingsCandidateFromEnv(env, deps);
  const secret =
    candidate.password == null
      ? null
      : encryptSecret(candidate.password, requireKey(deps));

  const current = await deps.collection.findOne({ _id: APP_SETTINGS_ID });
  // Same anti-overwrite guard as updateSettings: an undecryptable stored
  // secret stops the reset too (mount the right key first).
  if (current) checkSecretReadable(current, deps.key);
  const now = (deps.now ?? (() => new Date()))().toISOString();

  const payload = {
    schemaVersion: 1 as const,
    installationId: current?.installationId ?? candidate.installationId,
    profile: { ...candidate.profile, secret },
    routes: candidate.routes,
    mtu: candidate.mtu,
    acs: candidate.acs,
    updatedAt: now,
    updatedBy: opts.actor ?? null,
  };
  const $set: Partial<AppSettingsDoc> = payload;

  let updated: WithId<AppSettingsDoc> | null;
  if (current == null) {
    if (input.revision !== 0)
      throw new SettingsError(
        "CONFLICT",
        "settings are unconfigured; send revision 0",
      );
    const doc: AppSettingsDoc = {
      ...payload,
      _id: APP_SETTINGS_ID,
      revision: 1,
    };
    try {
      await deps.collection.insertOne(doc);
      updated = doc;
    } catch (err) {
      if (isDuplicateKeyError(err))
        throw new SettingsError(
          "CONFLICT",
          "settings already exist (concurrent reset won)",
        );
      throw err;
    }
  } else {
    const result = await deps.collection.findOneAndUpdate(
      { _id: APP_SETTINGS_ID, revision: input.revision },
      { $set: { ...$set, revision: input.revision + 1 } },
      { returnDocument: "after", includeResultMetadata: true },
    );
    updated = result.value ?? null;
    if (updated == null)
      throw new SettingsError(
        "CONFLICT",
        `revision ${input.revision} is stale`,
      );
  }

  const view = docToView(updated as AppSettingsDoc);
  return {
    view,
    revisionBefore: current?.revision ?? 0,
    desiredRevision: view.revision,
    applyState: "pending",
  };
}

// ---------------------------------------------------------------------------
// Internal (controller/ACS-agent) reads

/** Decrypted desired profile for the VPN controller's internal endpoint.
 * Never reachable through the BFF. */
export async function getDecryptedProfile(
  deps: AppSettingsDeps,
): Promise<DecryptedProfile> {
  const doc = await deps.collection.findOne({ _id: APP_SETTINGS_ID });
  if (!doc)
    throw new SettingsError("UNCONFIGURED", "settings are not initialized");
  checkSecretReadable(doc, deps.key);
  const password =
    doc.profile.secret == null
      ? null
      : decryptSecret(doc.profile.secret, requireKey(deps));
  return {
    revision: doc.revision,
    installationId: doc.installationId,
    server: doc.profile.server,
    username: doc.profile.username,
    password,
    routes: doc.routes,
    mtu: doc.mtu,
  };
}

/** Address-only view for the ACS-address agent endpoint (different token,
 * no profile material). Secret state is irrelevant here by design. */
export async function getAcsAddress(
  deps: AppSettingsDeps,
): Promise<
  | { status: "unconfigured" }
  | { status: "configured"; revision: number; acs: AcsAddress }
> {
  const doc = await deps.collection.findOne({ _id: APP_SETTINGS_ID });
  if (!doc) return { status: "unconfigured" };
  return { status: "configured", revision: doc.revision, acs: doc.acs };
}

// ---------------------------------------------------------------------------
// Engine-side secret material (files mounted read-only, never env values,
// never Git). Reading happens per call so operators can rotate the tokens
// or mount the key without a process restart.

export interface EngineSettingsSecrets {
  key: Buffer | null;
  controllerToken: Buffer | null;
  acsAddressToken: Buffer | null;
}

/** 32 raw bytes, or a 64-char hex encoding of them. */
function loadKeyFile(path: string): Buffer | null {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch {
    return null;
  }
  if (raw.length === SETTINGS_KEY_BYTES) return raw;
  const text = raw.toString("utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  return null;
}

function loadTokenFile(path: string): Buffer | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const token = text.trim();
  return token.length > 0 ? Buffer.from(token, "utf8") : null;
}

export function loadEngineSettingsSecrets(
  env: {
    SETTINGS_SECRET_KEY_FILE?: string;
    VPN_CONTROLLER_TOKEN_FILE?: string;
    ACS_ADDRESS_TOKEN_FILE?: string;
  } = process.env,
): EngineSettingsSecrets {
  const secrets: EngineSettingsSecrets = {
    key: env.SETTINGS_SECRET_KEY_FILE
      ? loadKeyFile(env.SETTINGS_SECRET_KEY_FILE)
      : null,
    controllerToken: env.VPN_CONTROLLER_TOKEN_FILE
      ? loadTokenFile(env.VPN_CONTROLLER_TOKEN_FILE)
      : null,
    acsAddressToken: env.ACS_ADDRESS_TOKEN_FILE
      ? loadTokenFile(env.ACS_ADDRESS_TOKEN_FILE)
      : null,
  };
  if (
    secrets.controllerToken &&
    secrets.acsAddressToken &&
    secrets.controllerToken.equals(secrets.acsAddressToken)
  ) {
    secrets.controllerToken = null;
    secrets.acsAddressToken = null;
  }
  return secrets;
}

export function settingsEnvFromProcess(
  env: Record<string, string | undefined> = process.env,
): BootstrapEnv {
  return {
    VPN_SERVER: env.VPN_SERVER,
    VPN_USERNAME: env.VPN_USERNAME,
    VPN_PASSWORD_FILE: env.VPN_PASSWORD_FILE,
    VPN_ROUTES: env.VPN_ROUTES,
    VPN_MTU: env.VPN_MTU,
    ACS_HOST: env.ACS_HOST,
    ACS_PORT: env.ACS_PORT,
    ACS_SCHEME: env.ACS_SCHEME,
    ACS_PATH: env.ACS_PATH,
    INSTALLATION_ID: env.INSTALLATION_ID,
  };
}
