// Installer flow against the NATIVE /init contract: the chosen password
// is stored with native hashing (never the default admin/admin), the
// app-level vpn/logs permissions are seeded, and re-running the
// installer after users exist changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";

const CHOSEN_PASSWORD = "Chosen-Installer-2026!";

async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<Response> {
  return fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(5000),
  });
}

void test("installer stores the chosen password and seeds app permissions", async () => {
  const app = await startApp();
  try {
    // Fresh installation: no users, no permissions.
    await collections.users.deleteMany({});
    await collections.permissions.deleteMany({});
    await app.refreshSnapshot();

    const statusBefore = (await (
      await app.appRequest("/init", {})
    ).json()) as Record<string, boolean>;
    assert.equal(statusBefore["users"], true);

    // Weak/invalid installer input is rejected as validation BEFORE any
    // user is created.
    const weak = await app.appRequest("/init", {
      method: "POST",
      body: JSON.stringify({
        users: [{ username: "admin", password: "short", roles: ["admin"] }],
      }),
    });
    assert.equal(weak.status, 400);
    assert.equal(await collections.users.countDocuments(), 0);

    // Valid installer payload: chosen password, admin role.
    const install = await app.appRequest("/init", {
      method: "POST",
      body: JSON.stringify({
        users: [
          { username: "admin", password: CHOSEN_PASSWORD, roles: ["admin"] },
        ],
      }),
    });
    assert.equal(install.status, 200);
    await app.refreshSnapshot();

    // The chosen password authenticates; the historical default does not.
    assert.equal(
      (await login(app.baseUrl, "admin", CHOSEN_PASSWORD)).status,
      200,
    );
    assert.equal((await login(app.baseUrl, "admin", "admin")).status, 400);

    // The stored document carries a native hash, never the raw password.
    const stored = await collections.users.findOne({ _id: "admin" });
    assert.ok(stored);
    assert.notEqual(stored["password"], CHOSEN_PASSWORD);
    assert.ok(typeof stored["salt"] === "string" && stored["salt"] !== "");
    assert.ok(!JSON.stringify(stored).includes(CHOSEN_PASSWORD));

    // App-level permissions (vpn/logs) exist for the bootstrap admin.
    for (const id of ["admin:vpn:3", "admin:logs:3"]) {
      const doc = await collections.permissions.findOne({ _id: id });
      assert.ok(doc, `${id} must be seeded`);
    }

    // Installer window closes once users exist.
    const statusAfter = (await (
      await app.appRequest("/init", {})
    ).json()) as Record<string, boolean>;
    assert.equal(statusAfter["users"], false);

    // Re-running the installer as anonymous changes NOTHING (the users
    // flag is revoked server-side); the chosen password still works.
    const again = await app.appRequest("/init", {
      method: "POST",
      body: JSON.stringify({
        users: [
          { username: "admin", password: "Other-Password-2026!", roles: [] },
        ],
      }),
    });
    assert.equal(again.status, 200);
    await app.refreshSnapshot();
    assert.equal(
      (await login(app.baseUrl, "admin", CHOSEN_PASSWORD)).status,
      200,
    );
    assert.equal(
      (await login(app.baseUrl, "admin", "Other-Password-2026!")).status,
      400,
    );
    assert.equal((await login(app.baseUrl, "admin", "admin")).status, 400);
  } finally {
    await app.stop();
  }
});
