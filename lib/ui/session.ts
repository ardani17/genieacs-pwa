// Session issuance and verification with an ABSOLUTE 8-hour bound.
// The engine stays the identity source; this module only wraps the
// native JWT semantics required by the app contract.

import * as jwt from "jsonwebtoken";
import { version as VERSION } from "../../package.json";

export const SESSION_MAX_AGE_SECONDS = 8 * 3600; // absolute cap: 28800s

export interface SessionClaims {
  username: string;
  authMethod: string;
  iat?: number;
  exp?: number;
}

export function issueSession(
  username: string,
  authMethod: string,
  secret: string,
): string {
  return jwt.sign({ username, authMethod }, secret, {
    expiresIn: SESSION_MAX_AGE_SECONDS,
  });
}

// A token is valid only when iat/exp are finite numbers, the lifetime
// stays within the 8h cap and it has not expired. No renewal anywhere.
export function verifySession(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): SessionClaims | null {
  let claims: SessionClaims;
  try {
    claims = jwt.verify(token, secret) as SessionClaims;
  } catch {
    return null;
  }
  const { iat, exp } = claims;
  if (typeof iat !== "number" || typeof exp !== "number") return null;
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp - iat > SESSION_MAX_AGE_SECONDS) return null;
  if (exp <= now) return null;
  return claims;
}

export interface SafeSessionInput {
  username: string;
  roles: string[];
  permissionSets: unknown[];
  uiConfig: Record<string, unknown>;
  configRevision: string;
  upstreamVersion?: string;
}

// The safe session DTO: selected fields ONLY — never the users snapshot
// (no password hashes, no salts, no cwmp auth data).
export function toSafeSession(input: SafeSessionInput): {
  username: string;
  roles: string[];
  permissionSets: unknown[];
  expiresAt: string;
  configRevision: string;
  uiConfig: Record<string, unknown>;
  appVersion: string;
  upstreamVersion: string;
  sessionMaxAgeSeconds: number;
} {
  return {
    username: input.username,
    roles: input.roles,
    permissionSets: input.permissionSets,
    expiresAt: new Date(
      Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    ).toISOString(),
    configRevision: input.configRevision,
    uiConfig: input.uiConfig,
    appVersion: VERSION,
    upstreamVersion: input.upstreamVersion ?? "",
    sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
  };
}
