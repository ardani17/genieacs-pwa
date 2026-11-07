// Server-side config masking (M06-B spec: "Normal list masks
// credential-looking value; reveal/edit requires authorized configread
// and explicit action"). The secret value must never cross to the
// browser BEFORE an explicit, permission-checked reveal — the old flow
// shipped the raw value and only masked it in client state (PR #8
// review).

export const SECRET_MASK = "••••••••";

const CREDENTIAL_LOOKING = /password|secret|token|key|credential/i;

export function isCredentialLookingId(id: string): boolean {
  return CREDENTIAL_LOOKING.test(id);
}

// Mask a config row for responses unless the caller explicitly asked to
// reveal AND holds config:3. The flag comes from the X-Reveal-Secrets
// header via revealRequested(); the permission check stays with the
// caller.
export function maskConfigRow(
  row: Record<string, unknown> | null,
  reveal: boolean,
): Record<string, unknown> | null {
  if (!row) return row;
  if (reveal) return row;
  if (typeof row._id !== "string" || !isCredentialLookingId(row._id))
    return row;
  return { ...row, value: SECRET_MASK };
}

// The reveal intent header — opt-in per request, never a sticky state.
export function revealRequested(header: unknown): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  return value === "1";
}
