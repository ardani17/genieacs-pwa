// M05-A: the device profile endpoint must enforce devices:2 + the
// caller's filter (unknown/filtered-out device ⇒ 404), resolve the
// verified ZTE profile server-side, and never echo parameter values.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";
import { PROFILE_MATRIX, makeGeneric } from "../fixtures/devices.ts";

void test("profile: permission, filter, verified/unverified resolution, no secrets", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    for (const device of [
      ...PROFILE_MATRIX.verifiedZte,
      ...PROFILE_MATRIX.unverifiedZteFirmware,
      makeGeneric({
        manufacturer: "Huawei",
        model: "HG8245H",
        id: "TEST-HUAWEI-PROFILE",
      }),
    ])
      await collections.devices.insertOne(device as never);

    // restricted may only see the TEST-DIAG-* devices (filter set below).
    await collections.permissions.updateOne(
      { _id: "fixtureRestricted:devices:2" },
      { $set: { filter: 'DeviceID.ID LIKE "TEST-DIAG-%"' } },
    );
    await app.refreshSnapshot();

    // Anonymous: 401.
    const anonymous = await app.appRequest(
      "/api/app/devices/TEST-ZTE-F670-1/profile",
    );
    assert.equal(anonymous.status, 401);

    // Verified firmware resolves to the verified ZTE profile with WAN.
    const verified = await app.appRequest(
      "/api/app/devices/TEST-ZTE-F670-1/profile",
      {},
      "operator",
    );
    assert.equal(verified.status, 200);
    const verifiedBody = (await verified.json()) as {
      profile: Record<string, unknown>;
    };
    assert.equal(verifiedBody.profile["verified"], true);
    assert.equal(verifiedBody.profile["wan"], true);
    assert.match(String(verifiedBody.profile["id"]), /zte-f670/);

    // Unknown ZTE firmware: generic profile, WAN write unsupported.
    const unverified = await app.appRequest(
      "/api/app/devices/TEST-ZTE-UNKNOWN/profile",
      {},
      "operator",
    );
    assert.equal(unverified.status, 200);
    const unverifiedBody = (await unverified.json()) as {
      profile: Record<string, unknown>;
    };
    assert.equal(unverifiedBody.profile["verified"], false);
    assert.equal(unverifiedBody.profile["wan"], false);

    // Non-ZTE vendor: generic read-only profile.
    const generic = await app.appRequest(
      "/api/app/devices/TEST-HUAWEI-PROFILE/profile",
      {},
      "operator",
    );
    assert.equal(generic.status, 200);
    const genericBody = (await generic.json()) as {
      profile: Record<string, unknown>;
    };
    assert.equal(genericBody.profile["vendor"], "generic");
    assert.equal(genericBody.profile["wan"], false);

    // Filtered-out device: 404 to this caller.
    const filtered = await app.appRequest(
      "/api/app/devices/TEST-ZTE-F670-1/profile",
      {},
      "restricted",
    );
    assert.equal(filtered.status, 404);

    // Inside the filter the same caller succeeds.
    await collections.permissions.updateOne(
      { _id: "fixtureRestricted:devices:2" },
      { $set: { filter: 'DeviceID.ID LIKE "TEST-ZTE-F670-%"' } },
    );
    await app.refreshSnapshot();
    const allowed = await app.appRequest(
      "/api/app/devices/TEST-ZTE-F670-1/profile",
      {},
      "restricted",
    );
    assert.equal(allowed.status, 200);

    // Unknown device: 404, never a 500.
    const missing = await app.appRequest(
      "/api/app/devices/DOES-NOT-EXIST/profile",
      {},
      "admin",
    );
    assert.equal(missing.status, 404);

    // The response carries no parameter VALUES — the PPPoE username
    // seeded by the fixture must not appear anywhere in the payload.
    const raw = await (
      await app.appRequest(
        "/api/app/devices/TEST-ZTE-F670-1/profile",
        {},
        "admin",
      )
    ).text();
    assert.ok(!raw.includes("test-user@example.invalid"), raw);
    assert.ok(!/"value"/.test(raw), raw);
  } finally {
    await app.stop();
  }
});
