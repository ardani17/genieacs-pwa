import test from "node:test";
import assert from "node:assert/strict";
import { startApp, FIXTURE_PASSWORD } from "./helpers/app.ts";
import { collections } from "../lib/db/db.ts";
import { verifySession } from "../lib/ui/session.ts";

void test("session never serializes user secrets", async () => {
  const app = await startApp();
  try {
    const r = await app.appRequest("/api/session", {}, "operator");
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.username, "operator");
    assert.ok(Date.parse(body.expiresAt) - Date.now() <= 28800000);
    assert.equal(JSON.stringify(body).includes("fixture-password-hash"), false);
    assert.equal(JSON.stringify(body).includes("fixture-salt"), false);
    // No credential material from the users snapshot.
    const text = JSON.stringify(body);
    assert.ok(!text.includes("password"));
    assert.ok(!text.includes("salt"));
  } finally {
    await app.stop();
  }
});

void test("session reflects the live permission snapshot", async () => {
  const app = await startApp();
  try {
    const before = await (
      await app.appRequest("/api/session", {}, "operator")
    ).json();
    assert.ok(Array.isArray(before.roles));
    assert.ok(before.roles.includes("fixtureOperator"));

    // Live permission change must be reflected (local cache window).
    await collections.permissions.updateMany(
      { role: "fixtureOperator" },
      { $set: { access: 1 } },
    );
    await app.refreshSnapshot();
    const after = await (
      await app.appRequest("/api/session", {}, "operator")
    ).json();
    assert.ok(after.permissionSets.length > 0);
  } finally {
    await app.stop();
  }
});

void test("expired or malformed sessions are rejected", async () => {
  const app = await startApp();
  try {
    // No cookie => 401.
    const anon = await app.appRequest("/api/session", {});
    assert.equal(anon.status, 401);

    // Deleted user mid-session => 401 on next request. The cookie must
    // be obtained BEFORE the deletion (login would fail afterwards).
    const cookie = await app.cookieFor("restricted");
    await collections.users.deleteOne({ _id: "restricted" });
    await app.refreshSnapshot();
    const gone = await fetch(`${app.baseUrl}/api/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(gone.status, 401);
  } finally {
    await app.stop();
  }
});

void test("token lifetime verification enforces the 8h cap", async () => {
  const secret = "unit-secret";
  // Hand-built over-lifetime token (exp-iat > 28800) must be rejected
  // even though the signature is valid.
  const now = Math.floor(Date.now() / 1000);
  const forged = Buffer.from(
    JSON.stringify({
      username: "x",
      authMethod: "local",
      iat: now - 100,
      exp: now + 28801 + 1000,
    }),
  ).toString("base64url");
  const { createHmac } = await import("node:crypto");
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`${header}.${forged}`)
    .digest("base64url");
  const token = `${header}.${forged}.${sig}`;
  assert.equal(verifySession(token, secret), null);

  // Missing exp/iat rejected.
  const noExp = Buffer.from(
    JSON.stringify({ username: "x", authMethod: "local" }),
  ).toString("base64url");
  const sig2 = createHmac("sha256", secret)
    .update(`${header}.${noExp}`)
    .digest("base64url");
  assert.equal(verifySession(`${header}.${noExp}.${sig2}`, secret), null);
});

// Hand-sign a token with the LISTENER's secret so the middleware (not
// just the helper) is what rejects invalid lifetimes.
async function signWithSecret(
  secret: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

void test("middleware enforces session lifetime claims on real requests", async () => {
  const secret = process.env["GENIEACS_UI_JWT_SECRET"];
  assert.ok(secret, "GENIEACS_UI_JWT_SECRET must be set by the harness");
  const now = Math.floor(Date.now() / 1000);

  const cases: {
    name: string;
    claims: Record<string, unknown>;
    ok: boolean;
  }[] = [
    {
      name: "no exp",
      claims: { username: "operator", authMethod: "local" },
      ok: false,
    },
    {
      name: "no iat",
      claims: { username: "operator", authMethod: "local", exp: now + 3600 },
      ok: false,
    },
    {
      name: "non-finite exp",
      claims: {
        username: "operator",
        authMethod: "local",
        iat: now,
        exp: Number.POSITIVE_INFINITY,
      },
      ok: false,
    },
    {
      name: "24h lifetime",
      claims: {
        username: "operator",
        authMethod: "local",
        iat: now - 3600,
        exp: now - 3600 + 86400,
      },
      ok: false,
    },
    {
      name: "expired",
      claims: {
        username: "operator",
        authMethod: "local",
        iat: now - 7200,
        exp: now - 60,
      },
      ok: false,
    },
    {
      name: "valid 8h",
      claims: {
        username: "operator",
        authMethod: "local",
        iat: now - 14400,
        exp: now - 14400 + 28800,
      },
      ok: true,
    },
  ];

  const app = await startApp();
  try {
    for (const c of cases) {
      const token = await signWithSecret(secret, c.claims);
      const res = await fetch(`${app.baseUrl}/api/session`, {
        headers: { Cookie: `genieacs-ui-jwt=${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (c.ok) assert.equal(res.status, 200, `${c.name} must be accepted`);
      else assert.equal(res.status, 401, `${c.name} must be rejected`);
    }
  } finally {
    await app.stop();
  }
});

void test("session DTO expiry comes from the validated token and does not slide", async () => {
  const secret = process.env["GENIEACS_UI_JWT_SECRET"];
  assert.ok(secret, "GENIEACS_UI_JWT_SECRET must be set by the harness");
  const now = Math.floor(Date.now() / 1000);
  // Issued 4h ago with an absolute 8h lifetime: 4h remain. A sliding
  // implementation would report now+8h instead of iat+8h.
  const iat = now - 14400;
  const token = await signWithSecret(secret, {
    username: "operator",
    authMethod: "local",
    iat,
    exp: iat + 28800,
  });

  const app = await startApp();
  try {
    const first = await fetch(`${app.baseUrl}/api/session`, {
      headers: { Cookie: `genieacs-ui-jwt=${token}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(first.status, 200);
    const dto1 = (await first.json()) as { expiresAt: string };
    const expectedMs = (iat + 28800) * 1000;
    assert.ok(
      Math.abs(Date.parse(dto1.expiresAt) - expectedMs) < 5000,
      `expiresAt must match the token exp (${dto1.expiresAt})`,
    );

    // Polling does not move the expiry.
    await new Promise((r) => setTimeout(r, 1200));
    const second = await fetch(`${app.baseUrl}/api/session`, {
      headers: { Cookie: `genieacs-ui-jwt=${token}` },
      signal: AbortSignal.timeout(5000),
    });
    const dto2 = (await second.json()) as { expiresAt: string };
    assert.equal(dto2.expiresAt, dto1.expiresAt);
  } finally {
    await app.stop();
  }
});

void test("self password change uses native semantics and safe errors", async () => {
  const app = await startApp();
  try {
    // Wrong old password and unauthenticated look the same.
    const wrong = await app.appRequest(
      "/api/password",
      {
        method: "POST",
        body: JSON.stringify({
          oldPassword: "wrong",
          newPassword: "New-Fixture-2026!",
        }),
      },
      "operator",
    );
    assert.equal(wrong.status, 401);

    // Anonymous cannot change.
    const anon = await app.appRequest("/api/password", {
      method: "POST",
      body: JSON.stringify({
        oldPassword: FIXTURE_PASSWORD,
        newPassword: "New-Fixture-2026!",
      }),
    });
    assert.equal(anon.status, 401);

    // Weak new password rejected as validation, distinct from auth.
    const weak = await app.appRequest(
      "/api/password",
      {
        method: "POST",
        body: JSON.stringify({
          oldPassword: FIXTURE_PASSWORD,
          newPassword: "short",
        }),
      },
      "operator",
    );
    assert.equal(weak.status, 400);

    // Correct change works and the NEW password authenticates natively.
    const ok = await app.appRequest(
      "/api/password",
      {
        method: "POST",
        body: JSON.stringify({
          oldPassword: FIXTURE_PASSWORD,
          newPassword: "New-Fixture-2026!",
        }),
      },
      "operator",
    );
    assert.equal(ok.status, 204);
    await app.refreshSnapshot();
    const relogin = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "operator",
        password: "New-Fixture-2026!",
      }),
    });
    assert.equal(relogin.status, 200);
  } finally {
    await app.stop();
  }
});

void test("permission boundaries: 401 vs 403", async () => {
  const app = await startApp();
  try {
    const anon = await app.appRequest("/api/devices", {});
    assert.equal(anon.status, 403); // anonymous = empty permission sets

    const restricted = await app.appRequest("/api/users", {}, "restricted");
    assert.equal(restricted.status, 403);

    const operator = await app.appRequest("/api/devices", {}, "operator");
    assert.equal(operator.status, 200);
  } finally {
    await app.stop();
  }
});
