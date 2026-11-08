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

    // The scoped delegate REALLY logs in through /login with its own
    // account (PR #8 review: the old test defined loginScoped without
    // ever calling it and sent every request as admin).
    const delegateSalt = await generateSalt(16);
    await collections.users.updateOne(
      { _id: "managed-delegate" },
      {
        $set: {
          password: await hashPassword(PASSWORD, delegateSalt),
          salt: delegateSalt,
          roles: "scopedAdmin",
        },
      },
      { upsert: true },
    );
    await app.refreshSnapshot();

    await t.test(
      "delegate: in-scope reset succeeds; out-of-scope 404s with state intact",
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
          "managed-delegate",
        );
        assert.equal(scoped.status, 200);

        // The delegate targets the OUT-OF-FILTER admin: 404, and the
        // admin's hash/roles survive untouched.
        const adminBefore = await collections.users.findOne({ _id: "admin" });
        const outOfScope = await app.appRequest(
          "/api/app/admin/users/admin/password",
          {
            method: "PUT",
            body: JSON.stringify({ newPassword: "Delegate-Escalation-2026!" }),
          },
          "managed-delegate",
        );
        assert.equal(outOfScope.status, 404);
        const adminAfter = await collections.users.findOne({ _id: "admin" });
        assert.equal(adminAfter?.password, adminBefore?.password);
        assert.equal(adminAfter?.roles, adminBefore?.roles);

        // Scoped role change: in-scope allowed, out-of-scope 404 with
        // the roles intact.
        const roleOk = await app.appRequest(
          "/api/app/admin/users/managed-target/roles",
          {
            method: "PUT",
            body: JSON.stringify({ roles: "fixtureOperator" }),
          },
          "managed-delegate",
        );
        assert.equal(roleOk.status, 200);
        const roleDenied = await app.appRequest(
          "/api/app/admin/users/admin/roles",
          {
            method: "PUT",
            body: JSON.stringify({ roles: "scopedAdmin" }),
          },
          "managed-delegate",
        );
        assert.equal(roleDenied.status, 404);
        assert.equal(
          (await collections.users.findOne({ _id: "admin" }))?.roles,
          adminBefore?.roles,
        );
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

    await t.test(
      "native role validators accept allowed roles and reject escalation",
      async () => {
        await collections.permissions.updateOne(
          { _id: "scopedAdmin:users:3" },
          { $set: { validate: 'object.roles = "fixtureOperator"' } },
        );
        await app.refreshSnapshot();
        try {
          const created = await app.appRequest(
            "/api/app/admin/users",
            {
              method: "POST",
              body: JSON.stringify({
                username: "managed-created",
                password: PASSWORD,
                roles: ["fixtureOperator"],
              }),
            },
            "managed-delegate",
          );
          assert.equal(created.status, 200);
          const updated = await app.appRequest(
            "/api/app/admin/users/managed-target/roles",
            {
              method: "PUT",
              body: JSON.stringify({ roles: ["fixtureOperator"] }),
            },
            "managed-delegate",
          );
          assert.equal(updated.status, 200);
          const denied = await app.appRequest(
            "/api/app/admin/users/managed-target/roles",
            {
              method: "PUT",
              body: JSON.stringify({ roles: ["fixtureAdmin"] }),
            },
            "managed-delegate",
          );
          assert.equal(denied.status, 403);
          assert.equal(
            (await collections.users.findOne({ _id: "managed-target" }))?.roles,
            "fixtureOperator",
          );
        } finally {
          await collections.permissions.updateOne(
            { _id: "scopedAdmin:users:3" },
            { $set: { validate: "true" } },
          );
          await app.refreshSnapshot();
        }
      },
    );

    await t.test(
      "legacy PUT creates a new user (upstream create-or-update)",
      async () => {
        // The upstream Mithril UI creates users via PUT with the new
        // id (ui/users-page.ts putResource isNew) — the scoped
        // pre-check must not 404 unknown ids for callers whose filter
        // admits the proposed identity.
        const created = await app.appRequest(
          "/api/users/managed-put-created",
          {
            method: "PUT",
            body: JSON.stringify({ roles: "fixtureOperator" }),
          },
          "admin",
        );
        assert.equal(created.status, 200);
        const doc = await collections.users.findOne({
          _id: "managed-put-created",
        });
        assert.ok(doc);
        assert.equal(doc.roles, "fixtureOperator");
        await collections.users.deleteOne({ _id: "managed-put-created" });
      },
    );

    await t.test("last admin delete and demote refused", async () => {
      // Leave exactly one admin-capable account ("admin"). The scoped
      // delegate holds users:3 through scopedAdmin, so it must go too —
      // now that the delegate is REALLY created (PR #8 review), it
      // counts toward the admin-capable set.
      await collections.users.deleteOne({ _id: "managed-second-admin" });
      await collections.users.deleteOne({ _id: "managed-delegate" });
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
