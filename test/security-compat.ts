import test, { after, before } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import * as jwt from "jsonwebtoken";
import Koa from "koa";
import koaBodyParser from "@koa/bodyparser";

// The live-database regressions run only inside the genieacs-pwa-check
// harness (compose.test.yaml sets MONGO_URL plus the GENIEACS_* fixture
// configuration before the process starts). Outside it — e.g. the plain
// CI `npm test` job — the harness-dependent tests skip instead of failing.
const SKIP = !process.env.MONGO_URL;

import { collections, connect, disconnect, filesBucket } from "../lib/db/db.ts";
import type { Device } from "../lib/db/types.ts";
import { set as cacheSet, pop as cachePop } from "../lib/cache.ts";
import { acquireLock, releaseLock } from "../lib/lock.ts";
import { putFile, downloadFile, deleteFile } from "../lib/ui/db.ts";
import { generateSalt, hashPassword } from "../lib/auth.ts";
import * as engineServer from "../lib/server.ts";
import { listener } from "../lib/ui.ts";

const JWT_SECRET = process.env.GENIEACS_UI_JWT_SECRET;
const JWT_COOKIE = "genieacs-ui-jwt";

const RESOURCES = [
  "devices",
  "presets",
  "provisions",
  "files",
  "virtualParameters",
  "config",
  "permissions",
  "users",
  "faults",
  "tasks",
];

const PASSWORD = "compat-Fixture-2026!";

let baseUrl: string;
let adminToken: string;
let restrictedToken: string;

async function seedFixtures(): Promise<void> {
  for (const collection of [
    collections.users,
    collections.permissions,
    collections.devices,
    collections.tasks,
    collections.presets,
    collections.provisions,
    collections.virtualParameters,
    collections.config,
    collections.faults,
  ])
    await collection.deleteMany({});

  // Aborted uploads can leave orphan chunks behind; start GridFS clean.
  try {
    await filesBucket.drop();
  } catch {
    // fs.files does not exist yet on a fresh database
  }

  const salt = await generateSalt(16);
  await collections.users.insertMany([
    {
      _id: "compat-admin",
      password: await hashPassword(PASSWORD, salt),
      salt,
      roles: "compatAdmin",
    },
    {
      _id: "compat-restricted",
      password: await hashPassword(PASSWORD, salt),
      salt,
      roles: "compatRestricted",
    },
  ]);

  const permissions = [];
  for (const resource of RESOURCES) {
    permissions.push({
      _id: `compat-admin-${resource}`,
      role: "compatAdmin",
      access: 3,
      resource,
      validate: null,
    });
  }
  // The restricted role can only read devices; everything else must 403.
  permissions.push({
    _id: "compat-restricted-devices",
    role: "compatRestricted",
    access: 2,
    resource: "devices",
    validate: null,
  });
  await collections.permissions.insertMany(permissions);

  // Device documents must use the tree parameter format: every leaf is an
  // attribute object with _object:false so flattenDevice stops descending.
  // A plain string leaf would recurse forever (strings are enumerable).
  const deviceDoc = (id: string): Device =>
    ({
      _id: id,
      _lastInform: new Date(),
      _registered: new Date(),
      DeviceID: {
        ID: {
          _value: id,
          _type: "xsd:string",
          _object: false,
          _timestamp: 1,
        },
        SerialNumber: {
          _value: `SN-${id}`,
          _type: "xsd:string",
          _object: false,
          _timestamp: 1,
        },
      },
    }) as Device;

  await collections.devices.insertMany([
    deviceDoc("compat-device-1"),
    deviceDoc("compat device 2"),
  ]);
}

before(async () => {
  if (SKIP) return;
  await connect();
  await seedFixtures();

  // The UI local cache only re-reads permissions/users on its 5 second
  // refresh boundary; wait one window out so seeded users are visible.
  await delay(5200);

  adminToken = jwt.sign(
    { username: "compat-admin", authMethod: "local" },
    JWT_SECRET,
  );
  restrictedToken = jwt.sign(
    { username: "compat-restricted", authMethod: "local" },
    JWT_SECRET,
  );

  // Boot through lib/server.ts exactly like bin/genieacs-ui: its connection
  // tracking feeds getRequestOrigin, which every access-logged route reads.
  engineServer.start(
    { port: 8931, host: "127.0.0.1", ssl: null, timeout: 120000 },
    async (req, res) => listener(req, res),
  );

  baseUrl = `http://127.0.0.1:8931`;
  for (let i = 0; i < 50; ++i) {
    try {
      const probe = await fetch(`${baseUrl}/status`);
      if (probe.ok) break;
    } catch {
      // not accepting connections yet
    }
    await delay(100);
  }
});

after(async () => {
  if (SKIP) return;
  await engineServer.stop();
  await disconnect();
});

function request(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: string;
    headers?: object;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  if (options.body != null) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
}

void test(
  "gridfs string-id files keep checksum, range and abort semantics",
  { skip: SKIP },
  async () => {
    const fileId = "compat-file-1.bin";
    const content = crypto.randomBytes(256 * 1024 + 7);
    await putFile(
      fileId,
      { contentType: "application/octet-stream" },
      Readable.from([content]),
    );

    const full = await new Promise<Buffer>((resolve, reject) => {
      const chunks = [];
      downloadFile(fileId)
        .on("data", (c) => chunks.push(c))
        .on("error", reject)
        .on("end", () => resolve(Buffer.concat(chunks)));
    });
    assert.equal(
      crypto.createHash("sha256").update(full).digest("hex"),
      crypto.createHash("sha256").update(content).digest("hex"),
    );
    assert.equal(full.length, content.length);

    // Byte-range via the driver stream options (end is exclusive).
    const ranged = await new Promise<Buffer>((resolve, reject) => {
      const chunks = [];
      filesBucket
        .openDownloadStreamByName(fileId, { start: 100, end: 200 } as any)
        .on("data", (c) => chunks.push(c))
        .on("error", reject)
        .on("end", () => resolve(Buffer.concat(chunks)));
    });
    assert.equal(ranged.length, 100);
    assert.ok(ranged.equals(content.subarray(100, 200)));

    // Abort mid-download: the process and the bucket stay usable afterwards.
    const aborted = downloadFile(fileId);
    await new Promise((resolve) => aborted.once("data", resolve));
    aborted.destroy();
    await deleteFile(fileId);
    assert.equal(await collections.files.countDocuments({}), 0);
  },
);

void test(
  "cache pop returns each stored value exactly once",
  { skip: SKIP },
  async () => {
    await cacheSet("compat-cache-key", "value-1", 60);
    assert.equal(await cachePop("compat-cache-key"), "value-1");
    assert.equal(await cachePop("compat-cache-key"), undefined);
  },
);

void test(
  "locks acquire, contend, reject wrong token and release",
  { skip: SKIP },
  async () => {
    const token1 = await acquireLock("compat-lock", 30000);
    assert.ok(token1);

    const token2 = await acquireLock("compat-lock", 30000, 0);
    assert.equal(token2, null);

    await assert.rejects(
      () => releaseLock("compat-lock", "wrong-token"),
      /Lock expired/,
    );

    await releaseLock("compat-lock", token1);
    const token3 = await acquireLock("compat-lock", 30000);
    assert.ok(token3);
    await releaseLock("compat-lock", token3);
  },
);

void test("anonymous requests are rejected", { skip: SKIP }, async () => {
  const res = await request("/api/ping/127.0.0.1");
  assert.equal(res.status, 401);
});

void test(
  "restricted permissions yield 403 outside the granted resource",
  { skip: SKIP },
  async () => {
    const devices = await request("/api/devices", { token: restrictedToken });
    assert.equal(devices.status, 200);

    const users = await request("/api/users", { token: restrictedToken });
    assert.equal(users.status, 403);
  },
);

void test(
  "admin can list devices, HEAD has no body, csv differs from detail",
  { skip: SKIP },
  async () => {
    const list = await request("/api/devices", { token: adminToken });
    assert.equal(list.status, 200);
    assert.match(list.headers.get("content-type") ?? "", /json/);
    const rows = await list.json();
    assert.equal(rows.length, 2);

    const head = await request("/api/devices", {
      method: "HEAD",
      token: adminToken,
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const csv = await request("/api/devices/compat-device-1.csv", {
      token: adminToken,
    });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /csv|octet-stream/);

    const detail = await request("/api/devices/compat-device-1", {
      token: adminToken,
    });
    assert.equal(detail.status, 200);
    assert.match(detail.headers.get("content-type") ?? "", /json/);
  },
);

void test(
  "url-encoded device ids resolve to the same document",
  { skip: SKIP },
  async () => {
    const res = await request(
      `/api/devices/${encodeURIComponent("compat device 2")}`,
      {
        token: adminToken,
      },
    );
    assert.equal(res.status, 200);
    const device = await res.json();
    // flattenDevice exposes the device id as the DeviceID.ID parameter.
    assert.equal(device["DeviceID.ID"].value[0], "compat device 2");
  },
);

void test(
  "unknown resources are 404 and unregistered methods run no handler",
  {
    skip: SKIP,
  },
  async () => {
    const missing = await request("/api/doesnotexist", { token: adminToken });
    assert.equal(missing.status, 404);

    // NOTE: the API router is mounted as router.use("/api", api.routes(),
    // api.allowedMethods()); with this nested mount neither @koa/router 13
    // (baseline, probed) nor 15 emits 405/Allow — unmatched methods fall
    // through to 404. Asserting that parity catches a semantic change in the
    // router upgrade; proper 405 responses are a deliberate API change, not
    // a regression fix.
    const method = await request("/api/devices/compat-device-1", {
      method: "PATCH",
      token: adminToken,
      body: "{}",
    });
    assert.equal(method.status, 404);
    assert.equal(method.headers.get("allow"), null);
  },
);

void test(
  "body parser rejects malformed and oversized json, login validates",
  { skip: SKIP },
  async () => {
    const malformed = await request("/login", {
      method: "POST",
      token: null,
      body: '{"username": "compat-admin", ',
    });
    assert.equal(malformed.status, 400);

    const badCredentials = await request("/login", {
      method: "POST",
      token: null,
      body: JSON.stringify({ username: "compat-admin", password: "wrong" }),
    });
    assert.equal(badCredentials.status, 400);

    const goodCredentials = await request("/login", {
      method: "POST",
      token: null,
      body: JSON.stringify({ username: "compat-admin", password: PASSWORD }),
    });
    assert.equal(goodCredentials.status, 200);
    assert.ok(goodCredentials.headers.get("set-cookie")?.includes(JWT_COOKIE));

    // The oversized-body rejection is asserted on an isolated Koa app with
    // the same bodyparser: the application's koa error handler intentionally
    // rethrows non-400 errors (bin/genieacs-ui.ts survives them via process
    // handlers), which would crash the test runner in-process.
    const probe = new Koa();
    probe.use(async (ctx, next) => {
      try {
        await next();
      } catch (err) {
        ctx.status = err.status ?? 500;
        ctx.body = err.message;
      }
    });
    probe.use(koaBodyParser());
    const probeServer = probe.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) =>
      probeServer.once("listening", resolve),
    );
    try {
      const oversized = await fetch(
        `http://127.0.0.1:${(probeServer.address() as any).port}/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: `{"x": "${"a".repeat(2 * 1024 * 1024)}"}`,
        },
      );
      assert.equal(oversized.status, 413);
      await oversized.arrayBuffer().catch(() => undefined);
    } finally {
      await new Promise<void>((resolve) => probeServer.close(() => resolve()));
    }
  },
);
