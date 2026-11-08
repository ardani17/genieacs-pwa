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
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  chownSync,
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

if (checkOnly) {
  const problems = [];
  if (!existsSync(dir)) problems.push(`missing directory ${dir}`);
  else
    for (const name of Object.keys(FILES)) {
      const path = resolve(dir, name);
      if (!existsSync(path)) {
        problems.push(`missing ${path}`);
        continue;
      }
      const parsed = parseExisting(name, readFileSync(path));
      if (parsed == null) problems.push(`unparseable ${path}`);
      else if (FILES[name].kind === "key")
        console.log(`key ${path} keyId=${keyFingerprint(parsed)}`);
    }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`secrets OK in ${dir}`);
  process.exit(0);
}

if (!existsSync(resolve(dir, KEY_FILE)) && !flag("--init-key"))
  throw new Error(
    "Missing settings key: restore from backup; use --init-key only for a new installation",
  );
mkdirSync(dir, { recursive: true, mode: 0o700 });
const created = [];
const kept = [];

for (const [name, spec] of Object.entries(FILES)) {
  const path = resolve(dir, name);
  if (existsSync(path)) {
    const existing = parseExisting(name, readFileSync(path));
    if (existing == null) {
      throw new Error(
        `Refusing to overwrite damaged secret ${name}; restore from backup`,
      );
    }
    if (force && spec.kind !== "key") {
      writeFileSync(path, spec.generate() + "\n", { mode: 0o600 });
      created.push(`${name} (rotated)`);
      continue;
    }
    kept.push(
      spec.kind === "key" ? `${name} keyId=${keyFingerprint(existing)}` : name,
    );
    continue;
  }
  writeFileSync(path, spec.generate() + "\n", { mode: 0o600, flag: "wx" });
  created.push(name);
}

for (const name of Object.keys(FILES)) {
  const path = resolve(dir, name);
  chmodSync(path, 0o600);
  if (process.getuid?.() === 0) chownSync(path, ownerUid, ownerGid);
}
console.log(JSON.stringify({ dir, created, kept }, null, 2));
