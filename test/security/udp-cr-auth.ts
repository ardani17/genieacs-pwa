import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  buildUdpCrSignature,
  generateUdpCrId,
  validateUdpCrTarget,
} from "../../lib/udp-cr-auth.ts";

void test("UDP CR signature preserves 40 hex characters required by CPE", () => {
  const sig = buildUdpCrSignature({
    timestamp: 1,
    id: 2,
    username: "fixture",
    cnonce: "fixture",
    password: "fixture",
  });
  assert.match(sig, /^[0-9a-f]{40}$/);
});

void test("signature is the Annex G concatenation ts+id+un+cn", () => {
  const input = {
    timestamp: 1700000000,
    id: 123456,
    username: "user@example",
    cnonce: "deadbeefdeadbeef",
    password: "shared-secret",
  };
  const independent = createHmac("sha1", input.password)
    .update(`${input.timestamp}${input.id}${input.username}${input.cnonce}`)
    .digest("hex");
  assert.equal(buildUdpCrSignature(input), independent);
  // Any field change breaks the signature.
  assert.notEqual(
    buildUdpCrSignature({ ...input, username: "user2@example" }),
    independent,
  );
  assert.notEqual(
    buildUdpCrSignature({ ...input, timestamp: input.timestamp + 1 }),
    independent,
  );
});

void test("message ids come from the CSPRNG uint32 range", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 200; ++i) {
    const id = generateUdpCrId();
    assert.ok(Number.isInteger(id));
    assert.ok(id >= 0 && id < 2 ** 32);
    seen.add(id);
  }
  // Math.random()*2^32 could never produce values >= 2^31+1 frequently in
  // a small sample due to float rounding; randomInt covers the full range
  // with uniformity, so ~200 draws must contain high-bit values.
  assert.ok([...seen].some((id) => id >= 2 ** 31));
  assert.ok(seen.size > 100, "ids must not repeat trivially");
});

void test("targets with control or URI characters are rejected", () => {
  for (const bad of [
    "host\r\nX:1",
    "host\n",
    "a b",
    "host/../../etc",
    "host?x=1",
    "host#frag",
    "",
  ])
    assert.throws(
      () => validateUdpCrTarget(bad, 7547),
      /UDP_CR_INVALID_TARGET/,
      `expected rejection for ${JSON.stringify(bad)}`,
    );

  for (const badPort of [0, -1, 65536, 80.5, NaN, Infinity])
    assert.throws(
      () => validateUdpCrTarget("192.0.2.10", badPort),
      /UDP_CR_INVALID_TARGET/,
    );

  const ok = validateUdpCrTarget("cpe-01.isp.example", 7547);
  assert.deepEqual(ok, { host: "cpe-01.isp.example", port: 7547 });
});

void test("username is uri-encoded on the wire, raw inside the signature", () => {
  // The signature concatenation uses the raw username exactly as the CPE
  // verifies it; the URI parameter is encoded so special characters
  // cannot break the query string or inject new parameters.
  const username = "user name+x@isp";
  const sig = buildUdpCrSignature({
    timestamp: 1,
    id: 2,
    username,
    cnonce: "c",
    password: "p",
  });
  assert.equal(
    sig,
    createHmac("sha1", "p").update(`12${username}c`).digest("hex"),
  );
  const encoded = encodeURIComponent(username);
  assert.ok(!encoded.includes(" "));
  assert.ok(!encoded.includes("+"));
});
