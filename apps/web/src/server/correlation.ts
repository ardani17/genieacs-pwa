// Correlation header contract shared by the edge proxy and the server
// modules. Leaf module on purpose: no imports, so the middleware bundle
// never pulls server-only code (fs/logger) into the edge runtime.

// The audit identity header. The proxy ALWAYS overwrites it with a
// freshly minted server UUID before route handlers run — a client may
// never choose its own audit id.
export const REQUEST_ID_HEADER = "x-request-id";

// The inbound UUID (when valid) is recorded as the PARENT of the
// minted id — never as the identity itself.
export const PARENT_REQUEST_ID_HEADER = "x-parent-request-id";

// Direct-mode client-address marker (RE-STD-08): at
// TRUSTED_PROXY_HOPS=0 the proxy deletes the client-supplied
// X-Forwarded-For and sets this marker; Next's HTTP server then
// re-injects x-forwarded-for from the TCP socket. The marker proves
// the XFF value the handlers see was server-derived, not spoofed.
export const TRUSTED_DIRECT_MARKER = "x-app-client-addr";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
