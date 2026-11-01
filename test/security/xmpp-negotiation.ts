import test from "node:test";
import assert from "node:assert/strict";
import { selectSasl } from "../../lib/xmpp-scram.ts";
import { getDefault } from "../../lib/config.ts";

// Negotiation-level security properties without a real XMPP server: the
// stream loop in lib/xmpp-client.ts always upgrades when starttls is
// offered and refuses mechanisms without a verified TLSSocket, so the
// effective negotiation surface is exactly selectSasl's policy.

void test("STARTTLS-missing and untrusted-TLS paths never authenticate", () => {
  const everything = new Set(["PLAIN", "SCRAM-SHA-1", "SCRAM-SHA-256"]);
  // No verified TLS: every combination is rejected — no automatic
  // downgrade, PLAIN never wins.
  for (const legacy of [false, true])
    for (const plain of [false, true])
      assert.throws(
        () => selectSasl(everything, false, legacy, plain),
        /TLS/,
        `legacy=${legacy} plain=${plain}`,
      );
});

void test("legacy fallbacks default to disabled in server config", () => {
  assert.equal(getDefault("XMPP_ALLOW_LEGACY_SHA1"), false);
  assert.equal(getDefault("XMPP_ALLOW_PLAIN"), false);
  // With defaults, a legacy-only server (no SHA-256) fails closed.
  assert.throws(
    () => selectSasl(new Set(["SCRAM-SHA-1", "PLAIN"]), true, false, false),
    /No acceptable/,
  );
});

void test("SCRAM-*-PLUS is never offered", () => {
  // Channel binding is not implemented; a server advertising only -PLUS
  // variants must not be negotiated into an unimplemented mechanism.
  assert.throws(
    () => selectSasl(new Set(["SCRAM-SHA-256-PLUS"]), true, true, true),
    /No acceptable/,
  );
});

void test("plain cannot beat scram when both are allowed", () => {
  assert.equal(
    selectSasl(new Set(["PLAIN", "SCRAM-SHA-1"]), true, true, true),
    "SCRAM-SHA-1",
  );
});
