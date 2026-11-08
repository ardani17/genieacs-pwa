import test from "node:test";
import assert from "node:assert/strict";
import { initialStatus, transition } from "../src/state.ts";

void test("auth rejection pauses, revision and reconnect clear pause without rollback", () => {
  let s = transition(
    initialStatus(0),
    { type: "profile", revision: 4, routes: [] },
    () => 0,
    () => 0,
  ).state;
  let r = transition(
    s,
    { type: "auth_rejected" },
    () => 0,
    () => 0,
  );
  assert.equal(r.state.state, "auth_failed");
  assert.equal(r.state.desiredRevision, 4);
  assert.equal(
    r.effects.some((e) => e.type === "schedule_retry"),
    false,
  );
  s = transition(r.state, { type: "retry" }, () => 0).state;
  assert.equal(s.state, "auth_failed");
  s = transition(s, { type: "reconnect" }, () => 0).state;
  assert.equal(s.state, "connecting");
  r = transition(s, { type: "profile", revision: 5, routes: [] }, () => 0);
  assert.equal(r.state.desiredRevision, 5);
  assert.equal(r.state.appliedRevision, null);
  assert.equal(r.state.attempt, 1);
});
void test("transient retry follows 10/20/40/60 seconds plus bounded jitter", () => {
  let s = transition(
    initialStatus(0),
    { type: "profile", revision: 1, routes: [] },
    () => 0,
  ).state;
  for (const seconds of [10, 20, 40, 60, 60]) {
    const r = transition(
      s,
      { type: "down", code: "PPP_EXIT" },
      () => 1000,
      () => 1,
    );
    assert.equal(
      r.state.nextAttemptAt,
      new Date(1000 + seconds * 1200).toISOString(),
    );
    s = transition(r.state, { type: "retry" }, () => 1000).state;
  }
  s = transition(
    s,
    {
      type: "up",
      interfaceName: "ppp0",
      localIp: "10.0.0.1",
      peerIp: "10.0.0.2",
    },
    () => 0,
  ).state;
  s = transition(s, { type: "stable" }, () => 60000).state;
  assert.equal(s.attempt, 0);
  const r = transition(
    s,
    { type: "down", code: "PPP_EXIT" },
    () => 60000,
    () => 0,
  );
  assert.equal(r.state.nextAttemptAt, new Date(70000).toISOString());
});
void test("stop, unsupported host and route failure never schedule retries", () => {
  const s = transition(
    initialStatus(0),
    { type: "profile", revision: 1, routes: [] },
    () => 0,
  ).state;
  for (const type of ["stop", "host_unsupported", "route_error"] as const) {
    const r = transition(s, { type }, () => 0);
    assert.equal(
      r.effects.some((e) => e.type === "schedule_retry"),
      false,
    );
    assert.equal(
      transition(r.state, { type: "down", code: "LATE_EXIT" }, () => 0).state
        .state,
      r.state.state,
    );
  }
  assert.equal(transition(s, { type: "reconnect" }, () => 0).effects.length, 0);
});
