// Review wave 5 (Spec P1): the authorized diagnostics endpoint must
// answer 404 for an unknown or filtered-out device. The route used to
// compose its permission filter as a bare two-element array — a LIST
// literal, not an AND — which the query synthesizer rejects with
// "Invalid query expression", turning every lookup (missing devices
// included) into a 500. This blocked the M04-C gate.
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
  },
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
    _value: "http://192.0.2.10:7547/",
    _type: "xsd:string",
    _object: false,
    _timestamp: 1,
  },
});

void test("diagnostics: unknown device 404, known device 200, filtered-out 404", async () => {
  const app = await startApp();
  try {
    await collections.devices.deleteMany({});
    await collections.devices.insertOne(deviceDoc("TEST-DIAG-1") as never);
    await collections.devices.insertOne(deviceDoc("TEST-OTHER-1") as never);
    // restricted may only diagnose the TEST-DIAG-* devices.
    await collections.permissions.updateOne(
      { _id: "fixtureRestricted:devices:2" },
      { $set: { filter: 'DeviceID.ID LIKE "TEST-DIAG-%"' } },
    );
    await app.refreshSnapshot();

    // Unknown device: 404, never a 500 from a rejected query expression.
    const missing = await app.appRequest(
      "/api/app/devices/DOES-NOT-EXIST/diagnostics",
      { method: "POST" },
      "operator",
    );
    assert.equal(missing.status, 404);

    // Existing device through the real query path: 200 with checks.
    const ok = await app.appRequest(
      "/api/app/devices/TEST-DIAG-1/diagnostics",
      { method: "POST" },
      "operator",
    );
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { checks: unknown[] };
    assert.ok(Array.isArray(body.checks));

    // Outside the caller's permission filter: 404 to this caller.
    const filtered = await app.appRequest(
      "/api/app/devices/TEST-OTHER-1/diagnostics",
      { method: "POST" },
      "restricted",
    );
    assert.equal(filtered.status, 404);

    // Inside the filter the same caller succeeds.
    const allowed = await app.appRequest(
      "/api/app/devices/TEST-DIAG-1/diagnostics",
      { method: "POST" },
      "restricted",
    );
    assert.equal(allowed.status, 200);
  } finally {
    await app.stop();
  }
});
