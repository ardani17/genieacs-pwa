// Application test harness: starts the REAL native UI listener on a
// test-only loopback port against the fixture database, seeds the
// identity fixtures with native salt/hash, and logs identities in
// through the actual /login route. No Authorizer mocks.

import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as engineServer from "../../lib/server.ts";
import { listener } from "../../lib/ui.ts";
import { connect, disconnect, collections } from "../../lib/db/db.ts";
import { del as cacheDel } from "../../lib/cache.ts";
import { generateSalt, hashPassword } from "../../lib/auth.ts";

export const FIXTURE_PASSWORD = "Fixture-Only-2026!";
const PORT = 8940;

export interface AppHarness {
  baseUrl: string;
  appRequest(
    target: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
    identity?: string,
  ): Promise<Response>;
  cookieFor(identity: string): Promise<string>;
  stop(): Promise<void>;
  refreshSnapshot(): Promise<void>;
}

let harness: AppHarness | null = null;

export async function startApp(): Promise<AppHarness> {
  if (harness) return harness;

  const fixtures = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "test/fixtures/identities.json"),
      "utf8",
    ),
  ) as {
    roles: Record<string, { resources: string[]; access: number }>;
    users: Record<string, string>;
  };

  await connect();

  // Seed roles/permissions + users with NATIVE hashing.
  await collections.users.deleteMany({});
  await collections.permissions.deleteMany({});
  const salt = await generateSalt(16);
  const hash = await hashPassword(FIXTURE_PASSWORD, salt);
  for (const [username, role] of Object.entries(fixtures.users)) {
    await collections.users.insertOne({
      _id: username,
      password: hash,
      salt,
      roles: role,
    });
  }
  for (const [role, def] of Object.entries(fixtures.roles)) {
    for (const resource of def.resources)
      await collections.permissions.insertOne({
        _id: `${role}:${resource}:${def.access}`,
        role,
        resource,
        access: def.access as 1 | 2 | 3,
        validate: "true",
      });
  }

  // Drop the stored local-cache hash so the next request recomputes the
  // snapshot from the freshly seeded data, then let the revision window
  // pass. (The hash equality check otherwise skips the refresh.)
  await cacheDel("ui-local-cache-hash");
  await new Promise((r) => setTimeout(r, 5300));

  engineServer.start(
    { port: PORT, host: "127.0.0.1", ssl: null, timeout: 15000 },
    async (req, res) => listener(req, res),
  );
  const baseUrl = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 50; ++i) {
    try {
      const probe = await fetch(`${baseUrl}/__probe__`, {
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 404) break;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const cookieCache = new Map<string, string>();

  const cookieFor = async (identity: string): Promise<string> => {
    const cached = cookieCache.get(identity);
    if (cached) return cached;
    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: identity, password: FIXTURE_PASSWORD }),
    });
    if (!res.ok) throw new Error(`fixture login failed for ${identity}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    const token = /genieacs-ui-jwt=([^;]+)/.exec(setCookie)?.[1];
    if (!token) throw new Error("fixture login returned no cookie");
    const cookie = `genieacs-ui-jwt=${token}`;
    cookieCache.set(identity, cookie);
    return cookie;
  };

  harness = {
    baseUrl,
    cookieFor,
    async appRequest(target, init = {}, identity) {
      const headers: Record<string, string> = {
        ...(init.headers ?? {}),
      };
      // JSON by default, but an explicit content type (e.g. octet-stream
      // file uploads) always wins.
      if (init.body !== undefined && !headers["Content-Type"])
        headers["Content-Type"] = "application/json";
      if (identity) headers["Cookie"] = await cookieFor(identity);
      return fetch(`${baseUrl}${target}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
        signal: AbortSignal.timeout(10_000),
      });
    },
    async refreshSnapshot() {
      // Single-process tests never see cross-worker cache updates: drop
      // the local-cache hash so the next request recomputes the
      // users/permissions snapshot from the database.
      await cacheDel("ui-local-cache-hash");
      await new Promise((r) => setTimeout(r, 5200));
    },
    async stop() {
      await engineServer.stop();
      await disconnect();
      harness = null;
    },
  };
  return harness;
}

void http.createServer;
