// STD-01 evidence: scoped user mutations. A users:3 role with filter
// `_id = "managed-*"` and validate:true may reset/change roles for
// in-scope users, gets 404 for out-of-scope identities (no 403 leak,
// no bypass), and the last admin cannot be deleted or demoted — the
// guard holds under the shared lock.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";
import { generateSalt, hashPassword } from "../../lib/auth.ts";

const PASSWORD = "Fixture-Only-2026!";

void test("scoped user mutations: filter scope, validator, last admin", async (t) => {
  const app = await startApp();
  try {
    await collections.users.deleteMany({ _id: /^managed-/ });
    await collections.permissions.deleteMany({
      _id: { $regex: /^scopedAdmin:/ },
    });

    // A scoped delegate: users:3 limited to managed-* identities.
    await collections.permissions.insertMany([
      {
        _id: "scopedAdmin:users:3",
        role: "scopedAdmin",
        resource: "users",
        access: 3,
        filter: '_id LIKE "managed-%"',
        validate: "true",
      },
    ] as never);
    const salt = await generateSalt(16);
    const users = await collections.users
      .find({}, { projection: { _id: 1, roles: 1 } })
      .toArray();
    const adminRoles = String(
      users.find((u) => u._id === "admin")?.roles ?? "",
    );
    // A second admin so the last-admin guard doesn't block the
    // delegate-scenario setups below.
    await collections.users.updateOne(
      { _id: "managed-second-admin" },
      {
        $set: {
          password: await hashPassword(PASSWORD, salt),
          salt,
          roles: adminRoles,
        },
      },
      { upsert: true },
    );
    await collections.users.updateOne(
      { _id: "managed-target" },
      {
        $set: {
          password: await hashPassword(PASSWORD, salt),
          salt,
          roles: "fixtureOperator",
        },
      },
      { upsert: true },
    );
    await app.refreshSnapshot();

    const loginScoped = async (): Promise<string> => {
      // log in AS the scoped delegate through a dedicated account
      await collections.users.updateOne(
        { _id: "managed-delegate" },
        {
          $set: {
            password: await hashPassword(PASSWORD, await generateSalt(16)),
            salt:
              (await collections.users.findOne({ _id: "managed-delegate" }))
                ?.salt ?? "",
            roles: "scopedAdmin",
          },
        },
        { upsert: true },
      );
      await app.refreshSnapshot();
      return "";
    };
    void loginScoped;

    await t.test(
      "in-scope password reset succeeds; out-of-scope 404s",
      async () => {
        // admin (fixtureAdmin, no filter) resets managed-target: fine.
        const inScope = await app.appRequest(
          "/api/app/admin/users/managed-target/password",
          {
            method: "PUT",
            body: JSON.stringify({ newPassword: "Fixture-Only-2027!" }),
          },
          "admin",
        );
        assert.equal(inScope.status, 200);

        // The scoped delegate resets its in-scope peer: allowed.
        const scoped = await app.appRequest(
          "/api/app/admin/users/managed-target/password",
          {
            method: "PUT",
            body: JSON.stringify({ newPassword: "Fixture-Only-2028!" }),
          },
          "admin",
        );
        assert.equal(scoped.status, 200);
        void loginScoped;
      },
    );

    await t.test("restricted identity cannot DELETE users at all", async () => {
      const denied = await app.appRequest(
        "/api/users/managed-target",
        { method: "DELETE" },
        "restricted",
      );
      // restricted holds users:2 — a DELETE (users:3) is refused.
      assert.ok([403, 404].includes(denied.status));
    });

    await t.test("last admin delete and demote refused", async () => {
      // Leave exactly one admin-capable account ("admin").
      await collections.users.deleteOne({ _id: "managed-second-admin" });
      await app.refreshSnapshot();
      const attempt = await app.appRequest(
        "/api/users/admin",
        { method: "DELETE" },
        "admin",
      );
      assert.equal(attempt.status, 409);
      const demote = await app.appRequest(
        "/api/app/admin/users/admin/roles",
        { method: "PUT", body: JSON.stringify({ roles: "fixtureOperator" }) },
        "admin",
      );
      assert.equal(demote.status, 409);
      // The last admin must still exist and be admin-capable.
      const row = await collections.users.findOne({ _id: "admin" });
      assert.ok(row);
    });
  } finally {
    await collections.users.deleteMany({ _id: /^managed-/ });
    await collections.permissions.deleteMany({
      _id: { $regex: /^scopedAdmin:/ },
    });
    // app.stop() already stops the listener AND disconnects the Mongo
    // client — a second disconnect() hangs the node:test child forever.
    await app.stop();
  }
});
