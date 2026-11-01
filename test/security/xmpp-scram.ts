import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import {
  selectSasl,
  scramProof,
  timingSafeEqualWithLength,
  validateServerNonce,
  SCRAM_ITERATION_MAX,
  SCRAM_MESSAGE_MAX_BYTES,
} from "../../lib/xmpp-scram.ts";

void test("TLS and SHA256 take precedence over PLAIN or legacy", () => {
  const methods = new Set(["PLAIN", "SCRAM-SHA-1", "SCRAM-SHA-256"]);
  assert.equal(selectSasl(methods, true, false), "SCRAM-SHA-256");
  assert.throws(() => selectSasl(methods, false, true), /TLS/);
});

void test("mechanism selection policy", () => {
  const full = new Set(["PLAIN", "SCRAM-SHA-1", "SCRAM-SHA-256"]);
  // SHA-256 always wins when present, legacy flags irrelevant.
  assert.equal(selectSasl(full, true, true, true), "SCRAM-SHA-256");
  // Without SHA-256: legacy SHA-1 only when explicitly allowed.
  const legacy = new Set(["PLAIN", "SCRAM-SHA-1"]);
  // SHA-1 disabled but PLAIN explicitly allowed: PLAIN is policy-approved.
  assert.equal(selectSasl(legacy, true, false, true), "PLAIN");
  // Both fallbacks disabled: fail closed.
  assert.throws(() => selectSasl(legacy, true, false, false), /No acceptable/);
  assert.equal(selectSasl(legacy, true, true), "SCRAM-SHA-1");
  // PLAIN needs verified TLS AND explicit policy; it never beats SCRAM.
  const plainOnly = new Set(["PLAIN"]);
  assert.throws(
    () => selectSasl(plainOnly, true, true, false),
    /No acceptable/,
  );
  assert.equal(selectSasl(plainOnly, true, false, true), "PLAIN");
  assert.throws(() => selectSasl(plainOnly, false, true, true), /TLS/);
  // No fallback after the stronger mechanism is unavailable.
  assert.throws(
    () => selectSasl(new Set(["EXTERNAL"]), true, true, true),
    /No acceptable/,
  );
  // Nothing is ever selected without TLS — even with every legacy flag.
  assert.throws(() => selectSasl(full, false, true, true), /TLS/);
});

void test("RFC 5802 SCRAM-SHA-1 known-answer vector", () => {
  // The official example exchange from RFC 5802 section 5.
  const clientFirstMessageBare = "n=user,r=fyko+d2lbbFgONRv9qkxdawL";
  const serverFirstMessage =
    "r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096";
  const clientFinalMessageWithoutProof =
    "c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j";
  const authMessage = `${clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`;

  const { proof, serverSignature } = scramProof({
    hash: "sha1",
    password: "pencil",
    salt: Buffer.from("QSXCR+Q6sek8bf92", "base64"),
    iterationCount: 4096,
    authMessage,
  });

  assert.equal(proof.toString("base64"), "v0X8v3Bz2T0CJGbJQyF0X+HI4Ts=");
  assert.equal(
    serverSignature.toString("base64"),
    "rmF9pqV8S7suAoZWja4dJRkFsKQ=",
  );
});

void test("SCRAM-SHA-256 follows RFC 7677 with the same construction", () => {
  const clientFirstMessageBare = "n=user,r=fyko+d2lbbFgONRv9qkxdawL";
  const serverFirstMessage =
    "r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096";
  const clientFinalMessageWithoutProof =
    "c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j";
  const authMessage = `${clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`;

  const { proof, serverSignature } = scramProof({
    hash: "sha256",
    password: "pencil",
    salt: Buffer.from("QSXCR+Q6sek8bf92", "base64"),
    iterationCount: 4096,
    authMessage,
  });

  assert.equal(proof.length, 32);
  assert.equal(serverSignature.length, 32);
  // Independent recomputation via the same published formula chain.
  const salted = pbkdf2Sync(
    "pencil",
    Buffer.from("QSXCR+Q6sek8bf92", "base64"),
    4096,
    32,
    "sha256",
  );
  const ck = createHmac("sha256", salted).update("Client Key").digest();
  const sk = createHash("sha256").update(ck).digest();
  const sig = createHmac("sha256", sk).update(authMessage).digest();
  const expected = Buffer.alloc(32);
  for (const [i, b] of sig.entries()) expected[i] = ck[i] ^ b;
  assert.ok(timingSafeEqualWithLength(proof, expected));
});

void test("tampered proofs, signatures and parameters fail verification", () => {
  const base = {
    hash: "sha256" as const,
    password: "pencil",
    salt: Buffer.from("QSXCR+Q6sek8bf92", "base64"),
    iterationCount: 4096,
    authMessage: "n=user,r=c,s=s,i=4096,c=biws,r=c",
  };
  const good = scramProof(base);
  const wrongPassword = scramProof({ ...base, password: "penciL" });
  assert.notEqual(
    good.proof.toString("hex"),
    wrongPassword.proof.toString("hex"),
  );
  assert.notEqual(
    good.serverSignature.toString("hex"),
    wrongPassword.serverSignature.toString("hex"),
  );
  const wrongIteration = scramProof({ ...base, iterationCount: 4097 });
  assert.notEqual(
    good.proof.toString("hex"),
    wrongIteration.proof.toString("hex"),
  );

  // Length mismatch is a mismatch; equal-length different buffers too.
  assert.equal(
    timingSafeEqualWithLength(good.proof, Buffer.from("short")),
    false,
  );
  assert.equal(
    timingSafeEqualWithLength(good.proof, good.serverSignature),
    false,
  );
  assert.equal(timingSafeEqualWithLength(good.proof, good.proof), true);
});

void test("parameter bounds protect against hostile servers", () => {
  const base = {
    hash: "sha1" as const,
    password: "p",
    salt: Buffer.alloc(16),
    iterationCount: 4096,
    authMessage: "n=u,r=c,c=biws,r=c",
  };
  assert.throws(() => scramProof({ ...base, iterationCount: 0 }), /iteration/);
  assert.throws(
    () => scramProof({ ...base, iterationCount: SCRAM_ITERATION_MAX + 1 }),
    /iteration/,
  );
  assert.throws(() => scramProof({ ...base, salt: Buffer.alloc(0) }), /salt/);
  assert.throws(
    () => scramProof({ ...base, salt: Buffer.alloc(2048) }),
    /salt/,
  );
  assert.throws(
    () =>
      scramProof({
        ...base,
        authMessage: "x".repeat(SCRAM_MESSAGE_MAX_BYTES + 1),
      }),
    /message/,
  );
});

void test("server nonce must extend the client nonce", () => {
  validateServerNonce("abc", "abcdef");
  assert.throws(() => validateServerNonce("abc", "abc"), /nonce/);
  assert.throws(() => validateServerNonce("abc", "abXdef"), /nonce/);
  assert.throws(() => validateServerNonce("abc", ""), /nonce/);
  assert.throws(() => validateServerNonce("abc", "xabc"), /nonce/);
});
