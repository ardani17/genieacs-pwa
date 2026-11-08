#!/usr/bin/env node
// Operator tool (run on the HOST, not in a container): creates the local
// secret material for saved settings (M07-A) —
//   secrets/settings-secret.key  32-byte AES-256-GCM key (hex, 64 chars)
//   secrets/vpn-controller.token internal controller-endpoint bearer
//   secrets/acs-address.token    ACS-address endpoint bearer (DIFFERENT)
// The directory is Git-ignored (`.gitignore` covers `secrets/`). The key
// is NEVER regenerated silently: without --force an existing key is kept
// (its fingerprint is printed so operators can compare with keyId logs);
// Existing keys are never rotated or repaired by this tool. Restore them
// from backup if damaged; key migration is a separate operation.
//
// Usage:
//   sudo node docker/bootstrap-secrets.mjs --init-key [--dir secrets]
//        [--uid 10001] [--gid 10001] [--force] [--check]
// --check: verify only (all files exist, key parses) — exit 1 otherwise.

import { randomBytes, createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  mkdirSync,
  readFileSync,
  writeSync,
  ftruncateSync,
  fchmodSync,
  fchownSync,
} from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const dir = resolve(optValue("--dir") ?? "secrets");
const force = flag("--force");
if (flag("--force-key"))
  throw new Error("Key rotation requires an explicit database migration");
const checkOnly = flag("--check");
const ownerUid = Number(optValue("--uid") ?? 10001);
const ownerGid = Number(optValue("--gid") ?? 10001);
if (
  !Number.isSafeInteger(ownerUid) ||
  ownerUid < 0 ||
  !Number.isSafeInteger(ownerGid) ||
  ownerGid < 0
)
  throw new Error("Invalid secret owner");
if (
  !checkOnly &&
  process.getuid &&
  process.getuid() !== 0 &&
  process.getuid() !== ownerUid
)
  throw new Error(
    "Run bootstrap as root or the configured UI UID so mode0600 secrets are readable by the UI",
  );

const KEY_FILE = "settings-secret.key";
const FILES = {
  [KEY_FILE]: { kind: "key", generate: () => randomBytes(32).toString("hex") },
  "vpn-controller.token": {
    kind: "token",
    generate: () => randomBytes(32).toString("base64url"),
  },
  "acs-address.token": {
    kind: "token",
    generate: () => randomBytes(32).toString("base64url"),
  },
};

const keyFingerprint = (hex) =>
  createHash("sha256")
    .update(Buffer.from(hex, "hex"))
    .digest("hex")
    .slice(0, 16);

function parseExisting(name, content) {
  const text = content.toString("utf8").trim();
  if (FILES[name].kind === "key") {
    if (content.length === 32) return content.toString("hex");
    if (!/^[0-9a-fA-F]{64}$/.test(text)) return null;
    return text;
  }
  return text.length > 0 ? text : null;
}

// Open once, then inspect, read and change only that descriptor. Never
// follow a final-component symlink or truncate a path checked earlier.
function openSecret(path, writable, create = false) {
  const fd = openSync(
    path,
    (writable ? constants.O_RDWR : constants.O_RDONLY) |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0) |
      (create ? constants.O_CREAT | constants.O_EXCL : 0),
    0o600,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096)
      throw new Error("Secret must be a small regular file with one link");
    return fd;
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

if (checkOnly) {
  const problems = [];
  for (const name of Object.keys(FILES)) {
    const path = resolve(dir, name);
    try {
      const fd = openSecret(path, false);
      let parsed;
      try {
        parsed = parseExisting(name, readFileSync(fd));
      } finally {
        closeSync(fd);
      }
      if (parsed == null) problems.push(`unparseable ${path}`);
      else if (FILES[name].kind === "key")
        console.log(`key ${path} keyId=${keyFingerprint(parsed)}`);
    } catch {
      problems.push(`missing or unsafe ${path}`);
    }
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`secrets OK in ${dir}`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true, mode: 0o700 });
const created = [];
const kept = [];

for (const [name, spec] of Object.entries(FILES)) {
  const path = resolve(dir, name);
  let fd;
  let isNew = false;
  try {
    fd = openSecret(path, true);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    if (spec.kind === "key" && !flag("--init-key")) {
      throw new Error(
        "Missing settings key: restore from backup; use --init-key only for a new installation",
      );
    }
    // If another creator wins this race, fail rather than overwrite it.
    fd = openSecret(path, true, true);
    isNew = true;
  }
  try {
    const existing = isNew ? null : parseExisting(name, readFileSync(fd));
    if (!isNew && existing == null) {
      throw new Error(
        `Refusing to overwrite damaged secret ${name}; restore from backup`,
      );
    }
    fchmodSync(fd, 0o600);
    if (process.getuid?.() === 0) fchownSync(fd, ownerUid, ownerGid);
    if (isNew || (force && spec.kind !== "key")) {
      const content = Buffer.from(spec.generate() + "\n");
      let offset = 0;
      while (offset < content.length)
        offset += writeSync(
          fd,
          content,
          offset,
          content.length - offset,
          offset,
        );
      ftruncateSync(fd, content.length);
      created.push(isNew ? name : `${name} (rotated)`);
    } else {
      kept.push(
        spec.kind === "key"
          ? `${name} keyId=${keyFingerprint(existing)}`
          : name,
      );
    }
  } finally {
    closeSync(fd);
  }
}
console.log(JSON.stringify({ dir, created, kept }, null, 2));
