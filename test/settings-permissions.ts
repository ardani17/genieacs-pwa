// M07-A integration: the settings API surface through the REAL engine
// listener — vpn:3 boundaries, bootstrap-once, CAS 409, reset-bootstrap,
// internal bearer-token isolation (controller vs ACS-address), token is
// never a session, saved values survive restart with changed env, and
// audit events carry field names/revisions only (never secrets).
//
// Env for key/token/log files is set at module top BEFORE dynamically
// importing the harness: lib/config.ts parses GENIEACS_* at load, and
// esbuild hoists static imports above module-body statements.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "settings-perms-"));
const CONTROLLER_TOKEN = "fixture-controller-token-0123456789abcdef";
const ACS_TOKEN = "fixture-acs-address-token-0123456789abcdef";
const BOOT_PASSWORD = "harness-boot-secret";
const logFile = join(dir, "settings-audit.ndjson");
const passwordFile = join(dir, "vpn-password.txt");

writeFileSync(join(dir, "settings.key"), Buffer.alloc(32, 3));
writeFileSync(join(dir, "controller.token"), `${CONTROLLER_TOKEN}\n`);
writeFileSync(join(dir, "acs-address.token"), `${ACS_TOKEN}\n`);
writeFileSync(passwordFile, `${BOOT_PASSWORD}\n`);

process.env.SETTINGS_SECRET_KEY_FILE = join(dir, "settings.key");
process.env.VPN_CONTROLLER_TOKEN_FILE = join(dir, "controller.token");
process.env.ACS_ADDRESS_TOKEN_FILE = join(dir, "acs-address.token");
process.env.GENIEACS_UI_APP_LOG_FILE = logFile;
process.env.VPN_SERVER = "vpn-harness.example.invalid";
process.env.VPN_USERNAME = "harness-user";
process.env.VPN_PASSWORD_FILE = passwordFile;
process.env.VPN_ROUTES = "172.16.0.0/12";
process.env.VPN_MTU = "1400";
process.env.ACS_HOST = "acs-harness.example.invalid";
process.env.ACS_PORT = "7547";
process.env.ACS_SCHEME = "http";
process.env.ACS_PATH = "/";

const profile = (
  revision: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  revision,
  server: "ui-saved.example.invalid",
  username: "ui-user",
  passwordAction: "replace",
  password: "ui-password-fixture",
  routes: ["10.77.0.0/16"],
  mtu: 1400,
  acs: {
    mode: "manual",
    scheme: "http",
    host: "acs-harness.example.invalid",
    port: 7547,
    path: "/",
  },
  ...overrides,
});

const VPN_PERMISSION_DOCS = [
  {
    _id: "fixtureAdmin:vpn:3",
    role: "fixtureAdmin",
    resource: "vpn",
    access: 3,
    validate: "true",
  },
  {
    _id: "fixtureOperator:vpn:1",
    role: "fixtureOperator",
    resource: "vpn",
    access: 1,
    validate: "true",
  },
] as const;

void test("settings API: permissions, CAS, reset, token isolation, restart", async () => {
  const { startApp } = await import("./helpers/app.ts");
  const { collections } = await import("../lib/db/db.ts");
  const { appSettingsCollection } = await import("../lib/ui/app-settings.ts");

  let app = await startApp();
  const appSettings = appSettingsCollection();
  await appSettings.deleteMany({});

  const seedVpnPermissions = async (): Promise<void> => {
    await collections.permissions.insertMany(
      VPN_PERMISSION_DOCS.map((d) => ({ ...d })) as never,
    );
  };
  await seedVpnPermissions();
  await app.refreshSnapshot();
  try {
    // --- permission boundaries -----------------------------------------
    const anon = await app.appRequest("/api/app/settings", { method: "GET" });
    assert.equal(anon.status, 401, "no session → 401");

    const opGet = await app.appRequest("/api/app/settings", {}, "operator");
    assert.equal(opGet.status, 403, "vpn:1 cannot read settings");

    const controllerFirst = await app.appRequest("/api/internal/vpn/profile", {
      headers: { authorization: `Bearer ${CONTROLLER_TOKEN}` },
    });
    assert.equal(
      controllerFirst.status,
      200,
      "controller bootstraps before any admin visit",
    );
    const adminGet = await app.appRequest("/api/app/settings", {}, "admin");
    assert.equal(adminGet.status, 200);
    const bootstrapped = (await adminGet.json()).data;
    assert.equal(bootstrapped.status, "configured");
    assert.equal(bootstrapped.view.server, "vpn-harness.example.invalid");
    assert.equal(bootstrapped.view.revision, 1);
    assert.equal(bootstrapped.view.passwordConfigured, true);
    assert.equal("password" in bootstrapped.view, false, "view is secret-free");

    // --- PUT: operator 403, admin saves, stale CAS 409, bad DTO 400 ----
    const opPut = await app.appRequest(
      "/api/app/settings",
      { method: "PUT", body: JSON.stringify(profile(1)) },
      "operator",
    );
    assert.equal(opPut.status, 403, "vpn:1 cannot write settings");

    const put = await app.appRequest(
      "/api/app/settings",
      { method: "PUT", body: JSON.stringify(profile(1)) },
      "admin",
    );
    assert.equal(put.status, 200);
    const putBody = (await put.json()).data;
    assert.equal(putBody.desiredRevision, 2);
    assert.equal(putBody.applyState, "failed");
    assert.equal(putBody.applyError, "VPN_CONTROLLER_UNAVAILABLE");
    assert.equal(putBody.view.server, "ui-saved.example.invalid");

    const stale = await app.appRequest(
      "/api/app/settings",
      { method: "PUT", body: JSON.stringify(profile(1)) },
      "admin",
    );
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, "CONFLICT");

    const bad = await app.appRequest(
      "/api/app/settings",
      { method: "PUT", body: JSON.stringify(profile(2, { server: "a\nb" })) },
      "admin",
    );
    assert.equal(bad.status, 400);
    const badBody = (await bad.json()).error;
    assert.equal(badBody.code, "VALIDATION");
    assert.ok(badBody.fieldErrors?.["server"], "per-field error present");

    // stored doc has no plaintext secret
    const rawDoc = await appSettings.findOne({ _id: "installation" });
    assert.equal(JSON.stringify(rawDoc).includes("ui-password-fixture"), false);

    // --- reset-bootstrap: confirm, CAS, happy path ----------------------
    const wrongConfirm = await app.appRequest(
      "/api/app/vpn/reset-bootstrap",
      {
        method: "POST",
        body: JSON.stringify({ revision: 2, confirm: "reset" }),
      },
      "admin",
    );
    assert.equal(wrongConfirm.status, 400);

    const wrongRevision = await app.appRequest(
      "/api/app/vpn/reset-bootstrap",
      {
        method: "POST",
        body: JSON.stringify({ revision: 1, confirm: "RESET" }),
      },
      "admin",
    );
    assert.equal(wrongRevision.status, 409);
    const keptView = (
      await (await app.appRequest("/api/app/settings", {}, "admin")).json()
    ).data;
    assert.equal(
      keptView.view.server,
      "ui-saved.example.invalid",
      "failed reset keeps the stored profile",
    );

    const opReset = await app.appRequest(
      "/api/app/vpn/reset-bootstrap",
      {
        method: "POST",
        body: JSON.stringify({ revision: 2, confirm: "RESET" }),
      },
      "operator",
    );
    assert.equal(opReset.status, 403, "vpn:1 cannot reset");

    const reset = await app.appRequest(
      "/api/app/vpn/reset-bootstrap",
      {
        method: "POST",
        body: JSON.stringify({ revision: 2, confirm: "RESET" }),
      },
      "admin",
    );
    assert.equal(reset.status, 200);
    const resetBody = (await reset.json()).data;
    assert.equal(resetBody.view.server, "vpn-harness.example.invalid");
    assert.equal(resetBody.view.revision, 3);

    // --- internal endpoints: token-only, route-scoped -------------------
    const noToken = await app.appRequest("/api/internal/vpn/profile", {});
    assert.equal(noToken.status, 401);

    const wrongToken = await app.appRequest("/api/internal/vpn/profile", {
      headers: { authorization: "Bearer not-the-token" },
    });
    assert.equal(wrongToken.status, 401);

    const controllerView = await app.appRequest("/api/internal/vpn/profile", {
      headers: { authorization: `Bearer ${CONTROLLER_TOKEN}` },
    });
    assert.equal(controllerView.status, 200);
    const controllerData = (await controllerView.json()).data;
    assert.equal(controllerData.password, BOOT_PASSWORD);
    assert.equal(controllerData.revision, 3);

    // Token isolation: the controller token must NOT open the ACS
    // address endpoint (and vice versa).
    const controllerOnAcs = await app.appRequest("/api/internal/acs-address", {
      headers: { authorization: `Bearer ${CONTROLLER_TOKEN}` },
    });
    assert.equal(controllerOnAcs.status, 401);

    const acsView = await app.appRequest("/api/internal/acs-address", {
      headers: { authorization: `Bearer ${ACS_TOKEN}` },
    });
    assert.equal(acsView.status, 200);
    const acsData = (await acsView.json()).data;
    assert.equal(acsData.status, "configured");
    assert.equal(acsData.acs.host, "acs-harness.example.invalid");
    assert.equal("server" in acsData, false);
    assert.equal("password" in acsData, false);

    const acsOnController = await app.appRequest("/api/internal/vpn/profile", {
      headers: { authorization: `Bearer ${ACS_TOKEN}` },
    });
    assert.equal(acsOnController.status, 401);

    // A service token is never a browser session.
    const tokenAsSession = await app.appRequest("/api/app/settings", {
      headers: { authorization: `Bearer ${CONTROLLER_TOKEN}` },
    });
    assert.equal(tokenAsSession.status, 401);

    // --- restart: saved values beat changed env -------------------------
    process.env.VPN_SERVER = "changed-after-restart.example.invalid";
    await app.stop();
    app = await startApp();
    await seedVpnPermissions();
    await app.refreshSnapshot();

    const afterRestart = await app.appRequest("/api/app/settings", {}, "admin");
    assert.equal(afterRestart.status, 200);
    const restartView = (await afterRestart.json()).data;
    assert.equal(restartView.status, "configured");
    assert.equal(
      restartView.view.server,
      "vpn-harness.example.invalid",
      "saved settings survive restart; env change is ignored",
    );
    assert.equal(restartView.view.revision, 3);

    // --- audit: field names and revisions only, never secrets ----------
    const logText = readFileSync(logFile, "utf8");
    assert.equal(logText.includes(BOOT_PASSWORD), false);
    assert.equal(logText.includes("ui-password-fixture"), false);
    const updatedEvents = logText
      .split("\n")
      .filter((l) => l.includes('"settings.updated"'));
    assert.ok(updatedEvents.length >= 2, "settings.updated events emitted");
    const sample = JSON.parse(
      updatedEvents.find((l) => l.includes("revisionBefore")) ?? "",
    );
    assert.ok(Array.isArray(sample.details?.fields));
    assert.equal(typeof sample.details?.revisionAfter, "number");
    assert.equal(typeof sample.actorId, "string");
  } finally {
    try {
      await app.stop();
    } catch {
      // already stopped by the restart phase's error path
    }
    await appSettings.deleteMany({}).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
