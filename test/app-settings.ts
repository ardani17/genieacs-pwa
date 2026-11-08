// M07-A behavior tests: AES-256-GCM secretbox, strict saved-settings DTO
// validation, and the app_settings store (bootstrap-once, revision CAS,
// anti-overwrite on wrong key, reset-bootstrap). Store tests run only in
// the genieacs-pwa-check harness (MONGO_URL selects the throwaway
// genieacs_plan_test fixture database).

import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encryptSecret,
  decryptSecret,
  computeKeyId,
  bootstrapSettings,
  getSettingsView,
  updateSettings,
  resetBootstrap,
  getDecryptedProfile,
  getAcsAddress,
  loadEngineSettingsSecrets,
  APP_SETTINGS_ID,
  SettingsError,
  type AppSettingsDeps,
  type AppSettingsDoc,
} from "../lib/ui/app-settings.ts";
import {
  validateVpnProfileInput,
  SETTINGS_LIMITS,
  type VpnProfileInput,
} from "../packages/app-contracts/src/settings.ts";

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);

const validInput = (
  overrides: Record<string, unknown> = {},
): VpnProfileInput => ({
  revision: 0,
  server: "vpn.example.invalid",
  username: "fixture-user",
  passwordAction: "replace",
  password: "fixture-vpn-password",
  routes: ["10.100.0.0/16"],
  mtu: 1400,
  acs: {
    mode: "manual",
    scheme: "http",
    host: "acs.example.invalid",
    port: 7547,
    path: "/",
  },
  ...overrides,
});

// --- secretbox -------------------------------------------------------------

void test("secret ciphertext authenticates data and wrong key fails", () => {
  const box = encryptSecret("fixture-vpn-password", KEY);
  assert.equal(
    JSON.stringify(box).includes("fixture-vpn-password"),
    false,
    "plaintext must never appear in the persisted box",
  );
  assert.equal(decryptSecret(box, KEY), "fixture-vpn-password");
  assert.throws(() => decryptSecret(box, OTHER_KEY), /STORAGE_ERROR/);
});

void test("each encryption uses a fresh IV and a derived keyId", () => {
  const a = encryptSecret("same-secret", KEY);
  const b = encryptSecret("same-secret", KEY);
  assert.notEqual(a.iv, b.iv);
  assert.equal(a.keyId, computeKeyId(KEY));
  assert.equal(computeKeyId(KEY).length, 16);
  assert.notEqual(computeKeyId(KEY), computeKeyId(OTHER_KEY));
  // keyId must not leak key material.
  assert.equal(JSON.stringify(a).includes(KEY.toString("hex")), false);
});

void test("tampered GCM tag, ciphertext and corrupt boxes fail closed", () => {
  const box = encryptSecret("fixture-vpn-password", KEY);
  const tamperedTag = { ...box, tag: "0".repeat(32) };
  assert.throws(() => decryptSecret(tamperedTag, KEY), /STORAGE_ERROR/);
  const tamperedCiphertext = {
    ...box,
    ciphertext:
      box.ciphertext.slice(0, -2) +
      (box.ciphertext.endsWith("00") ? "11" : "00"),
  };
  assert.throws(() => decryptSecret(tamperedCiphertext, KEY), /STORAGE_ERROR/);
  assert.throws(
    () =>
      decryptSecret(
        { iv: "zz", ciphertext: "zz", tag: "zz", keyId: "zz" },
        KEY,
      ),
    /STORAGE_ERROR/,
  );
  assert.throws(() => encryptSecret("x", Buffer.alloc(31, 1)), /STORAGE_ERROR/);
});

void test("secret files load as raw or hex keys plus tokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "settings-secrets-"));
  try {
    const rawKey = Buffer.alloc(32, 7);
    writeFileSync(join(dir, "raw.key"), rawKey);
    writeFileSync(join(dir, "hex.key"), KEY.toString("hex")); // 64 hex chars
    writeFileSync(join(dir, "ctrl.token"), "controller-token-fixture\n");
    writeFileSync(join(dir, "acs.token"), "acs-token-fixture\n");
    const secrets = loadEngineSettingsSecrets({
      SETTINGS_SECRET_KEY_FILE: join(dir, "raw.key"),
      VPN_CONTROLLER_TOKEN_FILE: join(dir, "ctrl.token"),
      ACS_ADDRESS_TOKEN_FILE: join(dir, "acs.token"),
    });
    assert.deepEqual(secrets.key, rawKey);
    assert.equal(
      secrets.controllerToken?.toString("utf8"),
      "controller-token-fixture",
    );
    assert.equal(
      secrets.acsAddressToken?.toString("utf8"),
      "acs-token-fixture",
    );

    const hex = loadEngineSettingsSecrets({
      SETTINGS_SECRET_KEY_FILE: join(dir, "hex.key"),
    });
    assert.equal(hex.key?.length, 32);
    const shared = loadEngineSettingsSecrets({
      VPN_CONTROLLER_TOKEN_FILE: join(dir, "ctrl.token"),
      ACS_ADDRESS_TOKEN_FILE: join(dir, "ctrl.token"),
    });
    assert.equal(
      shared.controllerToken,
      null,
      "consumer tokens must be distinct even after a deployment misconfiguration",
    );
    assert.equal(shared.acsAddressToken, null);

    // Missing files and wrong sizes degrade to null — never a fake key.
    assert.equal(
      loadEngineSettingsSecrets({
        SETTINGS_SECRET_KEY_FILE: join(dir, "missing.key"),
      }).key,
      null,
    );
    writeFileSync(join(dir, "short.key"), "tooshort");
    assert.equal(
      loadEngineSettingsSecrets({
        SETTINGS_SECRET_KEY_FILE: join(dir, "short.key"),
      }).key,
      null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- DTO validation --------------------------------------------------------

void test("valid profiles pass and carry the password only on replace", () => {
  const ok = validateVpnProfileInput(validInput());
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.server, "vpn.example.invalid");
    assert.equal(ok.value.password, "fixture-vpn-password");
  }
  const keep = validateVpnProfileInput(
    validInput({ passwordAction: "keep", password: undefined }),
  );
  assert.equal(keep.ok, true);
});

void test("unknown fields and bad shapes are rejected per field", () => {
  const bad = validateVpnProfileInput({ ...validInput(), extra: 1 });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.fieldErrors["extra"], "unknown field");

  for (const key of ["__proto__", "constructor", "toString"]) {
    const input = { ...validInput(), ...JSON.parse(`{"${key}":true}`) };
    const result = validateVpnProfileInput(input);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(Object.getPrototypeOf(result.fieldErrors), Object.prototype);
      assert.equal(Object.hasOwn(result.fieldErrors, key), true);
      assert.equal(result.fieldErrors[key], "unknown field");
      assert.equal(
        JSON.parse(JSON.stringify(result.fieldErrors))[key],
        "unknown field",
      );
    }
  }

  const notObject = validateVpnProfileInput("nope");
  assert.equal(notObject.ok, false);

  const serverNewline = validateVpnProfileInput(validInput({ server: "a\nb" }));
  assert.equal(serverNewline.ok, false);
  if (!serverNewline.ok) assert.ok(serverNewline.fieldErrors["server"]);

  const serverIpv6 = validateVpnProfileInput(
    validInput({ server: "2001:db8::1" }),
  );
  assert.equal(serverIpv6.ok, false); // L2TP server: IPv4 or DNS only

  const usernameNul = validateVpnProfileInput(validInput({ username: "a\0b" }));
  assert.equal(usernameNul.ok, false);

  const emptyReplace = validateVpnProfileInput(validInput({ password: "" }));
  assert.equal(emptyReplace.ok, false);

  const passwordWithKeep = validateVpnProfileInput(
    validInput({ passwordAction: "keep", password: "x" }),
  );
  assert.equal(passwordWithKeep.ok, false);

  const mtuLow = validateVpnProfileInput(
    validInput({ mtu: SETTINGS_LIMITS.mtuMin - 1 }),
  );
  assert.equal(mtuLow.ok, false);
  const mtuHigh = validateVpnProfileInput(
    validInput({ mtu: SETTINGS_LIMITS.mtuMax + 1 }),
  );
  assert.equal(mtuHigh.ok, false);

  const tooManyRoutes = validateVpnProfileInput(
    validInput({
      routes: Array.from(
        { length: SETTINGS_LIMITS.routesMax + 1 },
        (_, i) => `10.${Math.floor(i / 250)}.${i % 250}.0/24`,
      ),
    }),
  );
  assert.equal(tooManyRoutes.ok, false);
});

void test("routes must be strict IPv4 CIDRs without default or duplicates", () => {
  for (const [route, okExpected] of [
    ["10.0.0.0/8", true],
    ["0.0.0.0/0", false], // default route
    ["10.0.0.0/33", false],
    ["10.0.0.1/08", false], // leading-zero prefix
    ["010.0.0.1/8", false], // leading-zero octet
    ["10.0.0.1", false],
    ["2001:db8::/32", false], // IPv6 not accepted here
    ["10.0.0.0/8 ", false], // whitespace
  ] as const) {
    const res = validateVpnProfileInput(validInput({ routes: [route] }));
    assert.equal(res.ok, okExpected, `route ${JSON.stringify(route)}`);
  }
  const dup = validateVpnProfileInput(
    validInput({ routes: ["10.0.0.0/8", "10.0.0.0/8"] }),
  );
  assert.equal(dup.ok, false);
});

void test("ACS address modes validate strictly", () => {
  const ipv6Host = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "manual",
        scheme: "https",
        host: "2001:db8::1",
        port: 7547,
        path: "/cwmp",
      },
    }),
  );
  assert.equal(ipv6Host.ok, true);
  const expandedIpv6 = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "manual",
        scheme: "https",
        host: "2001:0db8:0000:0000:0000:0000:0000:0001",
        port: 7547,
        path: "/",
      },
    }),
  );
  assert.equal(
    expandedIpv6.ok,
    true,
    "valid IPv6 forms must not be rejected because URL normalizes their spelling",
  );

  const userinfo = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "manual",
        scheme: "http",
        host: "u:p@acs.example.invalid",
        port: 7547,
        path: "/",
      },
    }),
  );
  assert.equal(userinfo.ok, false);

  const queryInPath = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "manual",
        scheme: "http",
        host: "acs.example.invalid",
        port: 7547,
        path: "/?x=1",
      },
    }),
  );
  assert.equal(queryInPath.ok, false);

  const relativePath = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "manual",
        scheme: "http",
        host: "acs.example.invalid",
        port: 7547,
        path: "cwmp",
      },
    }),
  );
  assert.equal(relativePath.ok, false);

  const portZero = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "manual",
        scheme: "http",
        host: "acs.example.invalid",
        port: 0,
        path: "/",
      },
    }),
  );
  assert.equal(portZero.ok, false);

  const autoPppWithHost = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "auto-ppp",
        scheme: "http",
        host: "acs.example.invalid",
        port: 7547,
        path: "/",
      },
    }),
  );
  assert.equal(autoPppWithHost.ok, false);

  const autoPpNullHost = validateVpnProfileInput(
    validInput({
      acs: {
        mode: "auto-ppp",
        scheme: "http",
        host: null,
        port: 7547,
        path: "/",
      },
    }),
  );
  assert.equal(autoPpNullHost.ok, true);
});

// --- store (fixture Mongo only) --------------------------------------------

void test(
  "app_settings store: bootstrap-once, CAS, anti-overwrite, reset",
  { skip: !process.env.MONGO_URL },
  async () => {
    const client = new MongoClient(process.env.MONGO_URL!);
    await client.connect();
    const collection = client.db().collection<AppSettingsDoc>("app_settings");
    await collection.deleteMany({});

    const passwordDir = mkdtempSync(join(tmpdir(), "vpn-bootstrap-"));
    const passwordFile = join(passwordDir, "password");
    writeFileSync(passwordFile, "env-boot-password\n", {
      mode: 0o600,
      flag: "wx",
    });
    const env = {
      VPN_SERVER: "vpn-env.example.invalid",
      VPN_USERNAME: "env-user",
      VPN_PASSWORD_FILE: passwordFile,
      VPN_ROUTES: "10.50.0.0/16, 10.60.0.0/16",
      VPN_MTU: "1380",
      ACS_HOST: "acs-env.example.invalid",
      ACS_PORT: "7547",
      ACS_SCHEME: "http",
      ACS_PATH: "/",
    };
    const deps = (key: Buffer | null = KEY): AppSettingsDeps => ({
      collection,
      key,
    });

    try {
      // Bootstrap creates exactly once; a changed env never overwrites.
      const first = await bootstrapSettings(deps(), env);
      assert.equal(first.created, true);
      const changedEnv = { ...env, VPN_SERVER: "changed.example.invalid" };
      assert.equal(
        (await bootstrapSettings(deps(), changedEnv)).created,
        false,
      );
      const status = await getSettingsView(deps());
      assert.equal(status.status, "configured");
      if (status.status === "configured") {
        assert.equal(status.view.server, "vpn-env.example.invalid");
        assert.equal(status.view.mtu, 1380);
        assert.deepEqual(status.view.routes, ["10.50.0.0/16", "10.60.0.0/16"]);
        assert.equal(status.view.revision, 1);
        assert.equal(status.view.passwordConfigured, true);
        assert.equal("password" in status.view, false);
      }

      // Stored document must not contain the plaintext secret.
      const rawDoc = await collection.findOne({ _id: APP_SETTINGS_ID });
      assert.equal(JSON.stringify(rawDoc).includes("env-boot-password"), false);

      // Decrypted profile (controller view) and address-only view.
      const profile = await getDecryptedProfile(deps());
      assert.equal(profile.password, "env-boot-password");
      assert.equal(profile.revision, 1);
      const address = await getAcsAddress(deps());
      if (address.status === "configured") {
        assert.equal(address.acs.host, "acs-env.example.invalid");
        assert.equal("server" in address, false);
      } else assert.fail("expected configured address");

      // CAS: concurrent updates with the same revision have ONE winner.
      const race = await Promise.allSettled([
        updateSettings(
          deps(),
          validInput({ revision: 1, server: "race-a.example.invalid" }),
        ),
        updateSettings(
          deps(),
          validInput({ revision: 1, server: "race-b.example.invalid" }),
        ),
      ]);
      const conflicts = race.filter(
        (r) =>
          r.status === "rejected" &&
          (r.reason as SettingsError).code === "CONFLICT",
      );
      assert.equal(conflicts.length, 1, "exactly one CAS loser");
      const winners = race.filter((r) => r.status === "fulfilled");
      assert.equal(winners.length, 1);
      if (winners[0].status === "fulfilled") {
        assert.equal(winners[0].value.view.revision, 2);
        assert.equal(winners[0].value.desiredRevision, 2);
        assert.equal(winners[0].value.applyState, "pending");
      }

      // Stale revision after the race → 409 CONFLICT.
      await assert.rejects(
        updateSettings(
          deps(),
          validInput({ revision: 1, server: "stale.example.invalid" }),
        ),
        (err: SettingsError) => err.code === "CONFLICT",
      );

      // keep without a stored secret is rejected — bootstrap created one,
      // so wipe the secret field to hit that branch.
      await collection.updateOne(
        { _id: APP_SETTINGS_ID },
        { $set: { "profile.secret": null } },
      );
      await assert.rejects(
        updateSettings(
          deps(),
          validInput({
            revision: 2,
            passwordAction: "keep",
            password: undefined,
          }),
        ),
        (err: SettingsError) => err.code === "VALIDATION",
      );
      // restore a secret for the wrong-key tests (replace on revision 2)
      await updateSettings(
        deps(),
        validInput({ revision: 2, password: "second-secret" }),
      );

      // Wrong key: reads AND writes fail STORAGE_ERROR without overwriting.
      const before = await collection.findOne({ _id: APP_SETTINGS_ID });
      await assert.rejects(
        getSettingsView(deps(OTHER_KEY)),
        (err: SettingsError) => err.code === "STORAGE_ERROR",
      );
      await assert.rejects(
        updateSettings(
          deps(OTHER_KEY),
          validInput({ revision: 3, password: "third-secret" }),
        ),
        (err: SettingsError) => err.code === "STORAGE_ERROR",
      );
      const after = await collection.findOne({ _id: APP_SETTINGS_ID });
      assert.deepEqual(
        after?.profile.secret,
        before?.profile.secret,
        "wrong key must not overwrite the stored secret",
      );

      // Corrupted tag in the document → STORAGE_ERROR on read.
      await collection.updateOne(
        { _id: APP_SETTINGS_ID },
        { $set: { "profile.secret.tag": "f".repeat(32) } },
      );
      await assert.rejects(
        getSettingsView(deps()),
        (err: SettingsError) => err.code === "STORAGE_ERROR",
      );
      const corrupted = await collection.findOne({ _id: APP_SETTINGS_ID });
      await assert.rejects(
        updateSettings(deps(), validInput({ revision: 3 })),
        /STORAGE_ERROR/,
      );
      await assert.rejects(
        resetBootstrap(deps(), { revision: 3, confirm: "RESET" }, env),
        /STORAGE_ERROR/,
      );
      assert.deepEqual(
        await collection.findOne({ _id: APP_SETTINGS_ID }),
        corrupted,
      );

      // Reset: literal confirmation + current revision; failures keep the
      // stored profile. Re-bootstrap a clean doc first.
      await collection.deleteMany({});
      await bootstrapSettings(deps(), env);
      await updateSettings(
        deps(),
        validInput({ revision: 1, server: "ui-saved.example.invalid" }),
      );
      await assert.rejects(
        resetBootstrap(deps(), { revision: 2, confirm: "reset" }, env),
        (err: SettingsError) => err.code === "VALIDATION",
      );
      await assert.rejects(
        resetBootstrap(deps(), { revision: 1, confirm: "RESET" }, env),
        (err: SettingsError) => err.code === "CONFLICT",
      );
      const kept = await getSettingsView(deps());
      if (kept.status === "configured")
        assert.equal(kept.view.server, "ui-saved.example.invalid");

      const installationId = (await collection.findOne({
        _id: APP_SETTINGS_ID,
      }))!.installationId;
      const reset = await resetBootstrap(
        deps(),
        { revision: 2, confirm: "RESET" },
        env,
      );
      assert.equal(reset.view.server, "vpn-env.example.invalid");
      assert.equal(reset.view.revision, 3);
      assert.equal(
        (await collection.findOne({ _id: APP_SETTINGS_ID }))!.installationId,
        installationId,
      );
      const decrypted = await getDecryptedProfile(deps());
      assert.equal(decrypted.password, "env-boot-password");

      // Invalid deployment env never creates a document.
      await collection.deleteMany({});
      const invalid = await bootstrapSettings(deps(), {
        ...env,
        VPN_SERVER: "bad\nserver",
      });
      assert.equal(invalid.created, false);
      assert.equal(invalid.error?.code, "VALIDATION");
      assert.equal(await collection.countDocuments({}), 0);

      // An incomplete bootstrap must not create a password-less profile.
      await collection.deleteMany({});
      const envNoPassword = { ...env, VPN_PASSWORD_FILE: undefined };
      assert.equal(
        (await bootstrapSettings(deps(), envNoPassword)).created,
        false,
      );
      const noSecret = await getSettingsView(deps());
      assert.equal(noSecret.status, "unconfigured");
      await assert.rejects(
        updateSettings(
          deps(),
          validInput({
            revision: 1,
            passwordAction: "keep",
            password: undefined,
          }),
        ),
        (err: SettingsError) => err.code === "VALIDATION",
      );
    } finally {
      await collection.deleteMany({});
      rmSync(passwordDir, { recursive: true, force: true });
      await client.close();
    }
  },
);
