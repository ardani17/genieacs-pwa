// UDP Connection Request authentication (TR-069 Annex G) — protocol-only.
//
// The HMAC-SHA1 here is a wire requirement: CPEs verify exactly this
// construction over ts+id+un+cn and cannot negotiate a different
// algorithm, so it stays isolated in this helper and is NEVER used for
// password hashing or any non-protocol purpose (see
// docs/operations/legacy-protocol-crypto.md). The message id comes from
// a CSPRNG, not Math.random.

import { createHmac, randomInt } from "node:crypto";

export const UDP_CR_ID_MAX = 2 ** 32;

export function generateUdpCrId(): number {
  return randomInt(0, UDP_CR_ID_MAX);
}

export interface UdpCrSignatureInput {
  timestamp: number;
  id: number;
  username: string;
  cnonce: string;
  password: string;
}

// HMAC-SHA1 over the exact concatenation ts+id+un+cn; 40 hex characters,
// as required by the CPE-side verifier.
export function buildUdpCrSignature({
  timestamp,
  id,
  username,
  cnonce,
  password,
}: UdpCrSignatureInput): string {
  return createHmac("sha1", password)
    .update(`${timestamp}${id}${username}${cnonce}`)
    .digest("hex");
}

// Connection Request target validation: the host must be a plausible
// hostname/IP without whitespace or URI/control characters (no newline
// injection into the request line), and the port a valid TCP/UDP port.
export function validateUdpCrTarget(
  host: string,
  port: number,
): { host: string; port: number } {
  if (
    typeof host !== "string" ||
    !host.length ||
    host.length > 253 ||
    /[\s\r\n/\\\?#&=@]/.test(host)
  )
    throw new Error(`UDP_CR_INVALID_TARGET invalid host`);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`UDP_CR_INVALID_TARGET invalid port`);
  return { host, port };
}
