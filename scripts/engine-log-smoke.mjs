// Engine structured-log smoke (RE-STD-09B): drives the REAL engine UI
// over HTTP — failed login, successful login, permission denial — each
// carrying a UUID X-Request-Id, then validates the sanitized JSON
// events arrive in VictoriaLogs via the shared volume → Vector pipeline
// with service identity "ui" and matching request ids. This proves the
// ENGINE leg end to end; scripts/log-smoke.mjs covers the transport
// itself. Never just an HTTP 200: the stored records' content is
// validated, and the failed-login event must NOT contain the password.
import { randomUUID } from "node:crypto";

const engineUrl = process.env.ENGINE_URL ?? "http://ui:7583";
const logUrl = process.env.LOG_URL ?? "http://victorialogs:9428";
const pollMs = Number(process.env.SMOKE_POLL_MS ?? 30_000);
const fixturePassword = process.env.FIXTURE_PASSWORD ?? "Fixture-Only-2026!";

async function call(path, { method = "GET", requestId, cookie, body } = {}) {
  const res = await fetch(`${engineUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(requestId ? { "x-request-id": requestId } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
    redirect: "manual",
  });
  return {
    status: res.status,
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
  };
}

async function findInLogs(requestId, expectEvent) {
  const deadline = Date.now() + pollMs;
  while (Date.now() < deadline) {
    try {
      const q = await fetch(`${logUrl}/select/logsql/query`, {
        method: "POST",
        body: new URLSearchParams({
          query: `requestId:"${requestId}"`,
          limit: "5",
        }),
        signal: AbortSignal.timeout(3000),
      });
      const text = await q.text();
      if (text.includes(requestId) && !text.includes("cannot parse")) {
        const ok = text.includes(expectEvent) && text.includes('service="ui"');
        return { ok, text };
      }
    } catch {
      // not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, text: "" };
}

function fail(message) {
  process.stderr.write(
    JSON.stringify({ event: "engine-log.smoke.failed", reason: message }) +
      "\n",
  );
  process.exit(1);
}

// 1) Failed login (wrong password) with correlation id A.
const failedId = randomUUID();
const failedLogin = await call("/login", {
  method: "POST",
  requestId: failedId,
  body: { username: "admin", password: `wrong-${randomUUID()}` },
});
if (failedLogin.status !== 400)
  fail(`expected 400 on failed login, got ${failedLogin.status}`);

// 2) Successful login with correlation id B.
const okId = randomUUID();
const okLogin = await call("/login", {
  method: "POST",
  requestId: okId,
  body: { username: "admin", password: fixturePassword },
});
if (okLogin.status !== 200)
  fail(`expected 200 on login, got ${okLogin.status}`);

// 3) Permission denial: the restricted identity may not touch
//    /api/permissions (not in its resource allowlist).
const deniedId = randomUUID();
const restrictedLogin = await call("/login", {
  method: "POST",
  requestId: deniedId,
  body: { username: "restricted", password: fixturePassword },
});
if (restrictedLogin.status !== 200)
  fail(`restricted login failed: ${restrictedLogin.status}`);
const denied = await call("/api/permissions", {
  requestId: deniedId,
  cookie: restrictedLogin.cookie,
});
if (denied.status !== 403 && denied.status !== 401)
  fail(`expected 401/403 on denied resource, got ${denied.status}`);

const legs = [
  ["auth.login_failed", failedId],
  ["auth.login_succeeded", okId],
  ["auth.permission_denied", deniedId],
];
for (const [event, requestId] of legs) {
  const found = await findInLogs(requestId, event);
  if (!found.ok)
    fail(
      `${event} not searchable with service="ui" and requestId ${requestId}`,
    );
  // The failed-login event must never carry the submitted password.
  if (event === "auth.login_failed" && found.text.includes("wrong-"))
    fail("password material leaked into the stored login_failed event");
}

process.stdout.write(
  JSON.stringify({
    event: "engine-log.smoke.completed",
    legs: legs.map(([event, id]) => ({ event, requestId: id })),
    observedAt: new Date().toISOString(),
  }) + "\n",
);
