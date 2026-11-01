import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  digest,
  solveDigest,
  parseAuthorizationHeader,
} from "../../lib/auth.ts";

// RFC 7616 section 3.9.1 known-answer vectors (method GET).
const RFC = {
  username: "Mufasa",
  realm: "http-auth@example.org",
  password: "Circle of Life",
  nonce: "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
  uri: "/dir/index.html",
  method: "GET",
  nc: "00000001",
  cnonce: "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
  qop: "auth",
  body: "",
};

void test("unsupported advertised algorithm is never silently computed as MD5", () => {
  assert.throws(
    () =>
      solveDigest("fixture", "fixture", "/", "GET", "", {
        method: "Digest",
        realm: "test",
        nonce: "test",
        algorithm: "UNKNOWN",
      }),
    /algorithm/i,
  );
  assert.throws(
    () =>
      digest(
        "u",
        "r",
        "p",
        "n",
        "GET",
        "/",
        undefined,
        "",
        "",
        "",
        "UNKNOWN" as never,
      ),
    /algorithm/i,
  );
});

void test("RFC 7616 known-answer vectors for MD5 and SHA-256", () => {
  assert.equal(
    digest(
      RFC.username,
      RFC.realm,
      RFC.password,
      RFC.nonce,
      RFC.method,
      RFC.uri,
      RFC.qop,
      RFC.body,
      RFC.cnonce,
      RFC.nc,
      "MD5",
    ),
    "8ca523f5e9506fed4657c9700eebdbec",
  );
  assert.equal(
    digest(
      RFC.username,
      RFC.realm,
      RFC.password,
      RFC.nonce,
      RFC.method,
      RFC.uri,
      RFC.qop,
      RFC.body,
      RFC.cnonce,
      RFC.nc,
      "SHA-256",
    ),
    "753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1",
  );
});

void test("label and hash stay consistent, never MD5 for SHA-256", () => {
  const md5 = digest(
    RFC.username,
    RFC.realm,
    RFC.password,
    RFC.nonce,
    RFC.method,
    RFC.uri,
    RFC.qop,
    RFC.body,
    RFC.cnonce,
    RFC.nc,
    "MD5",
  );
  const sha = digest(
    RFC.username,
    RFC.realm,
    RFC.password,
    RFC.nonce,
    RFC.method,
    RFC.uri,
    RFC.qop,
    RFC.body,
    RFC.cnonce,
    RFC.nc,
    "SHA-256",
  );
  assert.notEqual(md5, sha);
  assert.equal(md5.length, 32);
  assert.equal(sha.length, 64);
});

void test("session variants follow RFC 7616 section 3.4.2", () => {
  // HA1_sess = H(H(username:realm:password):nonce:cnonce)
  const independent = (hashName: string): string => {
    const inner = createHash(hashName)
      .update(`${RFC.username}:${RFC.realm}:${RFC.password}`)
      .digest("hex");
    const ha1 = createHash(hashName)
      .update(`${inner}:${RFC.nonce}:${RFC.cnonce}`)
      .digest("hex");
    const ha2 = createHash(hashName)
      .update(`${RFC.method}:${RFC.uri}`)
      .digest("hex");
    return createHash(hashName)
      .update(`${ha1}:${RFC.nonce}:${RFC.nc}:${RFC.cnonce}:${RFC.qop}:${ha2}`)
      .digest("hex");
  };
  assert.equal(
    digest(
      RFC.username,
      RFC.realm,
      RFC.password,
      RFC.nonce,
      RFC.method,
      RFC.uri,
      RFC.qop,
      RFC.body,
      RFC.cnonce,
      RFC.nc,
      "MD5-sess",
    ),
    independent("md5"),
  );
  assert.equal(
    digest(
      RFC.username,
      RFC.realm,
      RFC.password,
      RFC.nonce,
      RFC.method,
      RFC.uri,
      RFC.qop,
      RFC.body,
      RFC.cnonce,
      RFC.nc,
      "SHA-256-sess",
    ),
    independent("sha256"),
  );
});

void test("auth-int covers the body and detects tampering", () => {
  const ok = digest(
    "u",
    "r",
    "p",
    "n",
    "POST",
    "/",
    "auth-int",
    "body-content",
    "c",
    "00000001",
    "SHA-256",
  );
  const tampered = digest(
    "u",
    "r",
    "p",
    "n",
    "POST",
    "/",
    "auth-int",
    "body-content!",
    "c",
    "00000001",
    "SHA-256",
  );
  assert.notEqual(ok, tampered);

  // Negative: a wrong password or nonce never reproduces the response.
  assert.notEqual(
    digest(
      "u",
      "r",
      "p",
      "n1",
      "POST",
      "/",
      "auth",
      "",
      "c",
      "00000001",
      "MD5",
    ),
    digest(
      "u",
      "r",
      "p",
      "n2",
      "POST",
      "/",
      "auth",
      "",
      "c",
      "00000001",
      "MD5",
    ),
  );
});

void test("solveDigest round-trips the advertised algorithm", () => {
  for (const algorithm of ["MD5", "SHA-256"] as const) {
    const solution = solveDigest(
      RFC.username,
      RFC.password,
      RFC.uri,
      RFC.method,
      RFC.body,
      {
        method: "Digest",
        realm: RFC.realm,
        nonce: RFC.nonce,
        qop: "auth",
        algorithm,
      },
    );
    assert.ok(solution.includes(`algorithm=${algorithm}`));
    const parsed = parseAuthorizationHeader(solution) as Record<string, string>;
    assert.equal(parsed.algorithm, algorithm);
    assert.equal(
      parsed.response,
      digest(
        RFC.username,
        RFC.realm,
        RFC.password,
        RFC.nonce,
        RFC.method,
        RFC.uri,
        "auth",
        RFC.body,
        parsed.cnonce,
        parsed.nc,
        algorithm,
      ),
    );
  }

  // Absent algorithm keeps the legacy MD5 default.
  const legacy = solveDigest("u", "p", "/", "GET", "", {
    method: "Digest",
    realm: "r",
    nonce: "n",
  });
  assert.match(legacy, /algorithm=MD5/);
});
