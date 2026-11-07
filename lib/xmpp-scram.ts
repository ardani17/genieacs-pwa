// XMPP SASL mechanism negotiation and SCRAM proof computation
// (RFC 5802 / RFC 7677), parameterized by hash name.
//
// Credentials are only ever sent over a VERIFIED TLS stream: selectSasl
// refuses to pick anything without it. SCRAM-SHA-256 wins when offered;
// SCRAM-SHA-1 and PLAIN are legacy fallbacks that an administrator must
// enable explicitly, and PLAIN additionally requires verified TLS plus
// policy. SCRAM-*-PLUS is deliberately not offered (no channel binding
// implementation).

import {
  createHash,
  createHmac,
  pbkdf2Sync,
  timingSafeEqual,
} from "node:crypto";

export type SaslMechanism = "SCRAM-SHA-256" | "SCRAM-SHA-1" | "PLAIN";
export type ScramHash = "sha256" | "sha1";

export function selectSasl(
  mechanisms: Set<string>,
  tlsVerified: boolean,
  allowLegacySha1: boolean,
  allowPlain = false,
): SaslMechanism {
  if (!tlsVerified)
    throw new Error("TLS: credentials require a verified TLS stream");

  if (mechanisms.has("SCRAM-SHA-256")) return "SCRAM-SHA-256";
  if (allowLegacySha1 && mechanisms.has("SCRAM-SHA-1")) return "SCRAM-SHA-1";
  if (allowPlain && mechanisms.has("PLAIN")) return "PLAIN";

  throw new Error(
    "No acceptable SASL mechanism (SCRAM-SHA-256 unavailable; legacy fallbacks disabled)",
  );
}

// SCRAM parameter bounds so a hostile server cannot force unbounded CPU
// or memory use.
export const SCRAM_ITERATION_MAX = 1_000_000;
export const SCRAM_SALT_MAX_BYTES = 1024;
export const SCRAM_MESSAGE_MAX_BYTES = 8192;

export interface ScramProofInput {
  hash: ScramHash;
  password: string;
  salt: Buffer;
  iterationCount: number;
  authMessage: string;
}

export function scramProof(input: ScramProofInput): {
  proof: Buffer;
  serverSignature: Buffer;
  saltedPassword: Buffer;
} {
  const { hash, password, salt, iterationCount, authMessage } = input;

  if (!Number.isInteger(iterationCount) || iterationCount < 1)
    throw new Error("SCRAM invalid iteration count");
  if (iterationCount > SCRAM_ITERATION_MAX)
    throw new Error("SCRAM iteration count exceeds limit");
  if (salt.length < 1 || salt.length > SCRAM_SALT_MAX_BYTES)
    throw new Error("SCRAM salt length out of bounds");
  if (Buffer.byteLength(authMessage, "utf8") > SCRAM_MESSAGE_MAX_BYTES)
    throw new Error("SCRAM message exceeds limit");

  const keyLength = hash === "sha256" ? 32 : 20;
  const saltedPassword = pbkdf2Sync(
    password,
    salt,
    iterationCount,
    keyLength,
    hash,
  );

  const clientKey = createHmac(hash, saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash(hash).update(clientKey).digest();
  const clientSignature = createHmac(hash, storedKey)
    .update(authMessage)
    .digest();

  const proof = Buffer.alloc(clientKey.length);
  for (const [i, b] of clientSignature.entries()) proof[i] = clientKey[i] ^ b;

  const serverKey = createHmac(hash, saltedPassword)
    .update("Server Key")
    .digest();
  const serverSignature = createHmac(hash, serverKey)
    .update(authMessage)
    .digest();

  return { proof, serverSignature, saltedPassword };
}

// Constant-time equality WITH length check — unequal lengths must not
// leak through timingSafeEqual's throw.
export function timingSafeEqualWithLength(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// The server nonce must start with the client nonce (RFC 5802 section
// 5.1) and be strictly longer.
export function validateServerNonce(
  clientNonce: string,
  serverNonce: string,
): void {
  if (typeof serverNonce !== "string" || serverNonce.length === 0)
    throw new Error("SCRAM missing server nonce");
  if (
    !serverNonce.startsWith(clientNonce) ||
    serverNonce.length <= clientNonce.length
  )
    throw new Error("SCRAM server nonce does not extend client nonce");
}
