import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
  statSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("bootstrap preserves raw keys, fails closed on damaged keys and never rotates keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "settings-key-"));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["docker/bootstrap-secrets.mjs", "--dir", dir, ...args],
      { encoding: "utf8" },
    );
  try {
    assert.equal(run("--init-key").status, 0);
    if (process.getuid?.() === 0) {
      chmodSync(dir, 0o755);
      const keyPath = join(dir, "settings-secret.key");
      assert.equal(statSync(keyPath).uid, 10001);
      const readable = spawnSync(
        process.execPath,
        ["-e", "require('node:fs').readFileSync(process.argv[1]);", keyPath],
        { uid: 10001, gid: 10001 },
      );
      assert.equal(
        readable.status,
        0,
        "the deployed non-root UI user must read its mounted secret",
      );
    }
    const path = join(dir, "settings-secret.key");
    const tokenPath = join(dir, "vpn-controller.token");
    const originalKey = readFileSync(path);
    const originalToken = readFileSync(tokenPath);
    assert.equal(run("--force").status, 0);
    assert.deepEqual(readFileSync(path), originalKey);
    assert.notDeepEqual(readFileSync(tokenPath), originalToken);
    assert.equal(readFileSync(tokenPath, "utf8").trim().length, 43);
    const raw = Buffer.alloc(32, 7);
    writeFileSync(path, raw);
    assert.equal(run().status, 0);
    assert.deepEqual(readFileSync(path), raw);
    assert.equal(run("--check").status, 0);
    assert.notEqual(run("--force", "--force-key").status, 0);
    assert.deepEqual(readFileSync(path), raw);
    writeFileSync(path, "damaged");
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(path, "utf8"), "damaged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bootstrap refuses linked secrets without altering their targets", () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "settings-links-"));
  const target = join(dir, "target");
  const keyPath = join(dir, "settings-secret.key");
  const key = Buffer.alloc(32, 9);
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["docker/bootstrap-secrets.mjs", "--dir", dir, ...args],
      { encoding: "utf8" },
    );
  try {
    writeFileSync(target, key, { mode: 0o600, flag: "wx" });
    symlinkSync(target, keyPath);
    assert.notEqual(run().status, 0);
    assert.notEqual(run("--check").status, 0);
    assert.deepEqual(readFileSync(target), key);
    rmSync(keyPath);
    linkSync(target, keyPath);
    assert.notEqual(run().status, 0);
    assert.deepEqual(readFileSync(target), key);
    assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
