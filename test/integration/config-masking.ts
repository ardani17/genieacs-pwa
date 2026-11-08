// M06-B evidence: credential-looking config values never leave the
// engine unmasked. Reveal is a per-request explicit action that still
// requires config:3; writing the mask sentinel back is refused (it
// would destroy the hidden credential). PR #8 review: the value used to
// cross to the browser before any reveal, and Reveal only flipped
// client state.
import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";

const MASK = "••••••••";

void test("config masking: server-side mask, explicit reveal, sentinel guard", async (t) => {
  const app = await startApp();
  const rows = [
    { _id: "app.tokenSecret", value: "'fixture-token-secret'" },
    { _id: "cwmp.connectionPassword", value: "'fixture-cwmp-password'" },
    { _id: "ui.pageSize", value: "25" },
  ];
  const ids = rows.map((r) => r._id);
  try {
    await collections.config.deleteMany({ _id: { $in: ids } });
    await collections.config.insertMany(rows as never);

    await t.test("masked by default for credential-looking ids", async () => {
      const res = await app.appRequest(
        "/api/config/app.tokenSecret",
        {},
        "admin",
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { value: string };
      assert.equal(body.value, MASK);
      // Non-credential rows pass through untouched (config values are
      // expression strings).
      const plain = await app.appRequest(
        "/api/config/ui.pageSize",
        {},
        "admin",
      );
      assert.equal(((await plain.json()) as { value: string }).value, "25");
    });

    await t.test(
      "reveal requires BOTH the explicit header and config:3",
      async () => {
        const revealed = await app.appRequest(
          "/api/config/app.tokenSecret",
          { headers: { "X-Reveal-Secrets": "1" } },
          "admin",
        );
        assert.equal(revealed.status, 200);
        assert.equal(
          ((await revealed.json()) as { value: string }).value,
          "'fixture-token-secret'",
        );

        // config:3 holders WITHOUT the explicit header stay masked.
        const noHeader = await app.appRequest(
          "/api/config/app.tokenSecret",
          {},
          "admin",
        );
        assert.equal(
          ((await noHeader.json()) as { value: string }).value,
          MASK,
        );

        // The header alone does not bypass the permission: operator holds
        // no config access at all.
        const noPerm = await app.appRequest(
          "/api/config/app.tokenSecret",
          { headers: { "X-Reveal-Secrets": "1" } },
          "operator",
        );
        assert.equal(noPerm.status, 403);
      },
    );

    await t.test("list rows keep the same mask policy", async () => {
      const res = await app.appRequest("/api/config", {}, "admin");
      assert.equal(res.status, 200);
      const list = (await res.json()) as { _id: string; value: unknown }[];
      const byId = new Map(list.map((r) => [r._id, r]));
      assert.equal(byId.get("app.tokenSecret")?.value, MASK);
      assert.equal(byId.get("ui.pageSize")?.value, "25");
    });

    await t.test("writing the mask sentinel back is refused", async () => {
      const res = await app.appRequest(
        "/api/config/app.tokenSecret",
        {
          method: "PUT",
          body: JSON.stringify({ _id: "app.tokenSecret", value: MASK }),
        },
        "admin",
      );
      assert.equal(res.status, 400);
      // The stored row is untouched.
      const row = await collections.config.findOne({
        _id: "app.tokenSecret",
      });
      assert.equal(row?.value, "'fixture-token-secret'");
    });
  } finally {
    await collections.config.deleteMany({ _id: { $in: ids } });
    await app.stop();
  }
});
