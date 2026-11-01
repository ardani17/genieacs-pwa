// Self-service password change: authenticates the CURRENT password via
// the native authLocal and hashes the new password with the native
// salt/hash functions. Requires a logged-in user; it is NOT the global
// users:write permission (admin resets keep the native
// /users/:id/password semantics).

import { collections } from "../db/db.ts";
import { authLocal } from "../api-functions.ts";
import { generateSalt, hashPassword } from "../auth.ts";

export async function changeOwnPassword(
  configSnapshot: string,
  username: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; reason?: "invalid_credentials" | "weak_password" }> {
  if (typeof newPassword !== "string" || newPassword.length < 8)
    return { ok: false, reason: "weak_password" };

  // Verify the current credentials through the same native path /login
  // uses — a wrong old password and an unknown user return the SAME
  // safe result.
  if (!(await authLocal(configSnapshot, username, oldPassword)))
    return { ok: false, reason: "invalid_credentials" };

  const salt = await generateSalt(16);
  const hash = await hashPassword(newPassword, salt);
  const result = await collections.users.updateOne(
    { _id: username },
    { $set: { password: hash, salt } },
  );
  if (result.matchedCount !== 1)
    return { ok: false, reason: "invalid_credentials" };
  return { ok: true };
}
