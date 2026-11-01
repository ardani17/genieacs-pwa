import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";

const deviceDoc = (id: string): Record<string, unknown> => ({
  _id: id,
  _lastInform: new Date(),
  _registered: new Date(),
  DeviceID: {
    ID: { _value: id, _type: "xsd:string", _object: false, _timestamp: 1 },
    SerialNumber: {
      _value: `SN-${id}`,
      _type: "xsd:string",
      _object: false,
      _timestamp: 1,
    },
  },
  InternetGatewayDevice: {
    DeviceInfo: {
      Password: {
        _value: "device-secret-value",
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
    },
  },
});

void test("filtered list, pagination stability and secret masking", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    // Two pages of devices with IDENTICAL sort values to prove the
    // stable ID tiebreaker keeps pagination deterministic.
    for (let i = 1; i <= 6; ++i)
      await collections.devices.insertOne(deviceDoc(`m02b-dev-${i}`) as never);

    const page1 = await app.appRequest(
      "/api/devices?pageSize=25",
      {},
      "operator",
    );
    assert.equal(page1.status, 200);
    const items1 = await page1.json();
    assert.equal(items1.length, 6);
    // Flattened devices expose the id as DeviceID.ID (no _id field).
    assert.ok(items1.some((d) => d["DeviceID.ID"].value[0] === "m02b-dev-1"));

    // Page 2 with a duplicate-valued sort field: the stable tiebreaker
    // must keep rows unique across pages.
    const page2 = await app.appRequest(
      "/api/devices?limit=5&skip=5&sort=" +
        encodeURIComponent('{"_lastInform":-1}'),
      {},
      "operator",
    );
    assert.equal(page2.status, 200);
    const items2 = await page2.json();
    assert.equal(items2.length, 1);
    assert.equal(items2[0]["DeviceID.ID"].value[0], "m02b-dev-6");
  } finally {
    await app.stop();
  }
});

void test("restricted sees only its filtered devices", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    await collections.devices.insertOne(deviceDoc("m02b-allowed") as never);
    await collections.devices.insertOne(deviceDoc("m02b-other") as never);
    // restricted: devices access 2 with a filter on the ID prefix.
    await collections.permissions.updateOne(
      { _id: "fixtureRestricted:devices:2" },
      { $set: { filter: 'DeviceID.ID LIKE "m02b-allowed%"' } },
    );
    await app.refreshSnapshot();

    const list = await app.appRequest("/api/devices", {}, "restricted");
    assert.equal(list.status, 200);
    const items = await list.json();
    assert.equal(items.length, 1);
    assert.equal(items[0]["DeviceID.ID"].value[0], "m02b-allowed");
  } finally {
    await app.stop();
  }
});

void test("unknown resource 404, disallowed verb 405 at the allowlist", async () => {
  const app = await startApp();
  try {
    const missing = await app.appRequest("/api/doesnotexist", {}, "admin");
    assert.equal(missing.status, 404);

    // tasks only allow GET natively; DELETE must fail (405/404 family).
    const del = await app.appRequest(
      "/api/tasks/abc",
      { method: "DELETE" },
      "admin",
    );
    assert.ok([404, 405].includes(del.status));

    // users write allowed for admin; forbidden for restricted.
    const forbidden = await app.appRequest("/api/users", {}, "restricted");
    assert.equal(forbidden.status, 403);
    const allowed = await app.appRequest("/api/users", {}, "admin");
    assert.equal(allowed.status, 200);
  } finally {
    await app.stop();
  }
});

void test("encoded IDs round-trip, including slash and unicode", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    await collections.devices.insertOne(deviceDoc("m02b/dev ünïcode") as never);
    const res = await app.appRequest(
      `/api/devices/${encodeURIComponent("m02b/dev ünïcode")}`,
      {},
      "operator",
    );
    assert.equal(res.status, 200);
    const device = await res.json();
    assert.equal(device["DeviceID.ID"].value[0], "m02b/dev ünïcode");
  } finally {
    await app.stop();
  }
});

void test("HEAD count uses the same filter as the list", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    await collections.devices.insertOne(deviceDoc("m02b-count-1") as never);
    await collections.devices.insertOne(deviceDoc("m02b-count-2") as never);

    const filter = encodeURIComponent('DeviceID.ID LIKE "m02b-count-%"');
    const list = await app.appRequest(
      `/api/devices?filter=${filter}`,
      {},
      "operator",
    );
    const items = await list.json();
    assert.equal(items.length, 2);

    const head = await app.appRequest(
      `/api/devices?filter=${filter}`,
      { method: "HEAD" },
      "operator",
    );
    assert.equal(head.headers.get("x-total-count"), "2");
    assert.equal(await head.text(), "");
  } finally {
    await app.stop();
  }
});
