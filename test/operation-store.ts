// app_operations store regressions (M05-B): atomic claim idempotency,
// fingerprint conflict, 24h TTL window and the startup sweep that turns
// orphaned in_progress operations into unknown — never a replay.
import test from "node:test";
import assert from "node:assert/strict";
import { connect, disconnect, collections } from "../lib/db/db.ts";
import {
  claimOperation,
  getOperation,
  requestFingerprint,
  sweepStaleOperations,
} from "../lib/ui/operation-store.ts";

const OP_ID = "11111111-2222-4333-8444-555555555555";

void test("operation store: claim, idempotency, conflict, TTL, sweep", async () => {
  await connect();
  await collections.appOperations.deleteMany({});
  try {
    // Fresh claim inserts an in_progress record with a 24h window.
    const first = await claimOperation(
      OP_ID,
      "admin",
      "TEST-OP-1",
      "commands",
      requestFingerprint({ a: 1 }),
    );
    assert.equal(first.claim, "new");
    assert.equal(first.operation.state, "in_progress");
    const ttlMs =
      first.operation.expiresAt.getTime() - first.operation.createdAt.getTime();
    assert.ok(ttlMs > 23 * 60 * 60 * 1000 && ttlMs <= 24 * 60 * 60 * 1000);

    // Same id + same fingerprint: the stored record, no second insert.
    const second = await claimOperation(
      OP_ID,
      "admin",
      "TEST-OP-1",
      "commands",
      requestFingerprint({ a: 1 }),
    );
    assert.equal(second.claim, "existing");
    assert.equal(
      second.operation.createdAt.getTime(),
      first.operation.createdAt.getTime(),
    );

    // Same id + different body: conflict.
    const conflict = await claimOperation(
      OP_ID,
      "admin",
      "TEST-OP-1",
      "commands",
      requestFingerprint({ a: 2 }),
    );
    assert.equal(conflict.claim, "conflict");

    // Different request bodies produce different fingerprints.
    assert.notEqual(requestFingerprint({ a: 1 }), requestFingerprint({ a: 2 }));

    // Startup sweep: an in_progress record from BEFORE this process
    // started becomes unknown without any replay.
    await collections.appOperations.updateOne(
      { _id: OP_ID },
      {
        $set: {
          state: "in_progress",
          updatedAt: new Date(Date.now() - 60_000),
        },
      },
    );
    const swept = await sweepStaleOperations();
    assert.ok(swept >= 1);
    const after = await getOperation(OP_ID);
    assert.equal(after.state, "unknown");

    // After the sweep, claiming the same id returns the swept record —
    // still no re-execution signal.
    const third = await claimOperation(
      OP_ID,
      "admin",
      "TEST-OP-1",
      "commands",
      requestFingerprint({ a: 1 }),
    );
    assert.equal(third.claim, "existing");
    assert.equal(third.operation.state, "unknown");
  } finally {
    await collections.appOperations.deleteMany({});
    await disconnect();
  }
});

void test("canonical fingerprint: key order does not change identity", () => {
  const a = requestFingerprint({
    deviceId: "D",
    tasks: [{ name: "reboot", expiry: 10 }],
    instance: null,
  });
  const b = requestFingerprint({
    instance: null,
    tasks: [{ expiry: 10, name: "reboot" }],
    deviceId: "D",
  });
  assert.equal(a, b);
  // Array order is semantics — reordering tasks is a DIFFERENT request.
  const c = requestFingerprint({
    deviceId: "D",
    tasks: [{ name: "reboot", expiry: 10 }, { name: "factoryReset" }],
  });
  const d = requestFingerprint({
    deviceId: "D",
    tasks: [{ name: "factoryReset" }, { name: "reboot", expiry: 10 }],
  });
  assert.notEqual(c, d);
});
