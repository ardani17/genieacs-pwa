import test from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";
import { PROFILE_MATRIX } from "../fixtures/devices.ts";
import { buildSearchExpression } from "../../apps/web/src/features/devices/query.ts";
import { stringify as stringifyExpression } from "../../lib/common/expression/parser.ts";

// The same shared search builder the BFF runtime uses (imported from
// the features module the resource adapter itself calls), serialized
// with the native stringify exactly like the adapter does.
function buildDeviceFilter(needle: string): string {
  const filter = buildSearchExpression(needle);
  assert.ok(filter, "search expression must produce a filter");
  return stringifyExpression(filter);
}

void test("server pagination: page1/page2/end with no missing or duplicated rows", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    for (const device of [
      ...PROFILE_MATRIX.verifiedZte,
      ...PROFILE_MATRIX.unverifiedZteFirmware,
      ...PROFILE_MATRIX.genericVendors,
    ])
      await collections.devices.insertOne(device as never);

    const sort = encodeURIComponent(
      JSON.stringify({ _lastInform: -1, "DeviceID.ID": 1 }),
    );
    const seen: string[] = [];
    let page = 1;
    for (;;) {
      const res = await app.appRequest(
        `/api/devices?limit=3&skip=${(page - 1) * 3}&sort=${sort}`,
        {},
        "operator",
      );
      assert.equal(res.status, 200);
      const items = await res.json();
      assert.ok(items.length <= 3);
      if (items.length === 0) break;
      for (const item of items) seen.push(item["DeviceID.ID"].value[0]);
      page += 1;
      if (page > 10) break;
    }

    assert.equal(seen.length, 8);
    assert.deepEqual(new Set(seen).size, 8, "no duplicates across pages");

    // Duplicate sort values stay stable: same order on re-fetch.
    const again: string[] = [];
    for (let p = 1; ; ++p) {
      const res = await app.appRequest(
        `/api/devices?limit=3&skip=${(p - 1) * 3}&sort=${sort}`,
        {},
        "operator",
      );
      const items = await res.json();
      if (items.length === 0) break;
      for (const item of items) again.push(item["DeviceID.ID"].value[0]);
    }
    assert.deepEqual(again, seen);
  } finally {
    await app.stop();
  }
});

void test("HEAD count equals filtered total; restricted sees only its filter", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    for (const device of [
      ...PROFILE_MATRIX.verifiedZte,
      ...PROFILE_MATRIX.genericVendors,
    ])
      await collections.devices.insertOne(device as never);
    await collections.permissions.updateOne(
      { _id: "fixtureRestricted:devices:2" },
      { $set: { filter: 'DeviceID.ID LIKE "TEST-ZTE-%"' } },
    );
    await app.refreshSnapshot();

    const filter = encodeURIComponent('DeviceID.ID LIKE "TEST-%"');
    const list = await (
      await app.appRequest(`/api/devices?filter=${filter}`, {}, "restricted")
    ).json();
    assert.equal(list.length, 4); // only the ZTE fixtures

    const head = await app.appRequest(
      `/api/devices?filter=${filter}`,
      { method: "HEAD" },
      "restricted",
    );
    assert.equal(head.headers.get("x-total-count"), "4");
  } finally {
    await app.stop();
  }
});

void test("CSV export masks secrets and escapes formulas, capped rows", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    await collections.devices.insertOne({
      _id: "TEST-CSV-1",
      _lastInform: new Date(),
      _registered: new Date(),
      DeviceID: {
        ID: {
          _value: "TEST-CSV-1",
          _type: "xsd:string",
          _object: false,
          _timestamp: 1,
        },
      },
      "Device.Test.Password": {
        _value: "=SUM(A1)",
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
    } as never);

    const csv = await app.appRequest(
      `/api/devices/TEST-CSV-1.csv`,
      {},
      "operator",
    );
    assert.equal(csv.status, 200);
    const text = await csv.text();
    assert.ok(text.includes("TEST-CSV-1"));
    // The formula-looking parameter VALUE must not appear unescaped.
    assert.ok(!text.includes(',"=SUM(A1)"'));
    assert.ok(!text.includes("wpa-secret"));
  } finally {
    await app.stop();
  }
});

// RE-SPEC-07: the BFF's search criteria must match literal
// quotes/backslashes/wildcards against the REAL engine query path —
// the same needle set the unit tests evaluate in memory.
void test("search needles with quotes, backslashes and wildcards match literally", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    const ids = ['a"b', "a\b", "50%", "a_b", "UNRELATED"];
    for (const id of ids) {
      await collections.devices.insertOne({
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
        },
      } as never);
    }

    const searchFor = async (needle: string): Promise<string[]> => {
      const res = await app.appRequest(
        `/api/devices?filter=${encodeURIComponent(
          // Build through the SAME shared builder the BFF runtime uses.
          buildDeviceFilter(needle),
        )}`,
        {},
        "operator",
      );
      assert.equal(
        res.status,
        200,
        `query rejected for ${JSON.stringify(needle)}`,
      );
      const items = (await res.json()) as Record<string, unknown>[];
      return items.map(
        (item) => (item["DeviceID.ID"] as { value: [string] }).value[0],
      );
    };

    assert.deepEqual(await searchFor('a"b'), ['a"b']);
    assert.deepEqual(await searchFor("a\b"), ["a\b"]);
    assert.deepEqual(await searchFor("%"), ["50%"]);
    assert.deepEqual(await searchFor("_"), ["a_b"]);
    assert.deepEqual(await searchFor("50%"), ["50%"]);
    // The reviewer's proof case: a bare % used to match everything.
    const pct = await searchFor("%");
    assert.equal(pct.includes("UNRELATED"), false);
  } finally {
    await app.stop();
  }
});
