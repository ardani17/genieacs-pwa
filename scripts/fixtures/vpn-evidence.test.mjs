import test from "node:test";
import assert from "node:assert/strict";
import { statusEvidence } from "./vpn-evidence.mjs";

const status = {
  state: "connected",
  desiredRevision: 1,
  appliedRevision: 1,
  interfaceName: "ppp0",
  localIp: "192.0.2.2",
  peerIp: "192.0.2.1",
  attempt: 0,
  nextAttemptAt: null,
  lastErrorCode: null,
  observedAt: "2026-11-08T00:00:00.000Z",
  routes: [{ cidr: "198.51.100.0/24", installed: true }],
};
test("lab evidence projects safe fields without persisting unexpected credentials", () => {
  assert.deepEqual(
    statusEvidence({
      ...status,
      password: "must-not-persist",
      routes: [{ ...status.routes[0], password: "must-not-persist" }],
    }),
    status,
  );
  for (const invalid of [
    null,
    { ...status, desiredRevision: -1 },
    { ...status, attempt: "secret" },
    { ...status, state: "arbitrary" },
    { ...status, localIp: "secret" },
    { ...status, routes: [{ cidr: "0.0.0.0/0", installed: true }] },
  ]) {
    assert.throws(() => statusEvidence(invalid), /INVALID_STATUS_EVIDENCE/);
  }
});
