# Legacy protocol cryptography

GenieACS speaks TR-069 with CPEs whose authentication is fixed by the protocol's
history. This page records where legacy cryptography remains, why it cannot
simply be removed, and the boundary around it.

## HTTP Digest (CWMP and connection requests)

- `lib/auth.ts` `digest()`/`solveDigest()` implement RFC 7616 with an algorithm
  allowlist: `MD5`, `SHA-256`, `MD5-sess`, `SHA-256-sess`. Absent `algorithm`
  defaults to **MD5** for legacy challenge compatibility; an advertised label is
  honored with the hash it names and unknown labels are rejected — a SHA-256
  challenge is never silently answered with an MD5 computation.
- The inbound CWMP challenge (`lib/cwmp.ts`) still omits `algorithm`, i.e.
  defaults to MD5, **until a CPE-migration decision approves advertising
  SHA-256**. Verification (`lib/cwmp.ts` AUTH check) accepts any allowlisted
  algorithm the CPE actually used and recomputes with that exact hash.
- Outgoing connection requests (`lib/connection-request.ts`) use `solveDigest`,
  which picks the strongest allowlisted algorithm the ACS side advertises and
  mirrors the peer's advertised label.
- MD5 here is **protocol-only**: it digests the shared CPE credential in the
  TR-069 handshake, is unrelated to dashboard user passwords (PBKDF2-SHA512,
  `lib/auth.ts` `hashPassword`), and never protects non-CWMP traffic. Restrict
  CWMP exposure to the management network and terminate TLS where the deployment
  supports it (`CWMP_SSL_KEY/CERT`).
- Removing MD5 entirely requires a CPE lab validating SHA-256 support across the
  fleet; it is tracked as a human risk decision, not a silent cleanup. Until
  then any residual CodeQL findings on the MD5 call sites stay open/accepted
  with an expiry — agents do not dismiss them.

## UDP Connection Request (TR-069 Annex G)

- The UDP Connection Request signature uses HMAC-SHA1 **on the wire** because
  the CPE-side verification algorithm is fixed by the specification; see
  `lib/udp-cr-auth.ts` for the isolated helper and the nonce/id generation
  policy. It is protocol-only and carries no dashboard credential.

## XMPP SASL

- Mechanisms: `SCRAM-SHA-256` preferred; `SCRAM-SHA-1` and `PLAIN` are legacy
  fallbacks gated by server-side `XMPP_ALLOW_LEGACY_SHA1` / `XMPP_ALLOW_PLAIN`
  (both default **false**, set via deployment configuration, never browser
  input). `SCRAM-*-PLUS` is not offered (no channel-binding implementation).
- Credentials are only sent on a verified TLS stream: the client always takes
  STARTTLS when offered and refuses mechanism negotiation without it — no
  automatic downgrade or certificate bypass. **Migration note:** this diverges
  from the baseline, which authenticated PLAIN/SCRAM-SHA-1 over plaintext; XMPP
  servers without TLS now fail closed and need an explicit legacy decision by an
  administrator.
- SCRAM proofs use PBKDF2 with the mechanism's hash, bounded iterations
  (1..1,000,000), salt (≤1024B) and message size (≤8192B); the server nonce must
  extend the client nonce and the `v=` server signature is verified
  constant-time with a length check.
