// Native user-mutation guards (STD-01 remediation): every user write
// path — the legacy resource routes and the app admin endpoints —
// resolves its target THROUGH the caller's users:3 filter (an
// out-of-scope user is a 404, exactly like the native routes), runs
// the native validator against the PROPOSED change, and mutations
// that can remove admin capability hold one shared lock while
// checking the last-admin invariant so parallel requests cannot both
// "win".
import { and, evaluate } from "../common/expression/util.ts";
import Authorizer from "../common/authorizer.ts";
import * as db from "./db.ts";
import { collections } from "../db/db.ts";
import { acquireLock, releaseLock } from "../lock.ts";

export const USERS_GUARD_LOCK = "app_users_admin_guard";

export interface ScopedUser {
  _id: string;
  roles: string;
}

// Fetch one user through the caller's permission filter. Returns null
// for missing AND out-of-scope targets — indistinguishable on purpose.
export async function fetchScopedUser(
  authorizer: Authorizer,
  id: string,
): Promise<ScopedUser | null> {
  const filter = and(authorizer.getFilter("users", 3), [
    "=",
    ["PARAM", "_id"],
    id,
  ]);
  const { value } = await db.query("users", filter).next();
  return (value as ScopedUser | null) ?? null;
}

// For CREATION there is no row to fetch: evaluate the caller's filter
// against the proposed identity instead.
export function userPassesFilter(authorizer: Authorizer, id: string): boolean {
  const filter = authorizer.getFilter("users", 3);
  if (filter == null || filter === true) return true;
  const outcome = evaluate(
    filter as never,
    { _id: id, id } as never,
    Date.now(),
  );
  return !Array.isArray(outcome) && !!outcome;
}

async function adminRoleSet(): Promise<Set<string>> {
  const rows = await collections.permissions
    .find({ resource: "users", access: 3 })
    .toArray();
  return new Set(rows.map((p) => p.role));
}

export function rolesGrantAdmin(
  roles: string,
  adminRoles: Set<string>,
): boolean {
  return String(roles ?? "")
    .split(",")
    .some((r) => adminRoles.has(r.trim()));
}

export class LastAdminError extends Error {
  status = 409;

  constructor() {
    super(
      "Perubahan ini akan meninggalkan nol admin. Pulihkan lewat runbook reset admin.",
    );
    this.name = "LastAdminError";
  }
}

// Run a mutation that may change who holds admin capability under the
// shared guard lock. `remainingAdmins` must report how many
// admin-capable accounts exist AFTER the proposed change; zero → the
// mutation is refused and nothing is written.
export async function withLastAdminGuard(
  propose: () => Promise<{ remainingAdmins: number }>,
): Promise<void> {
  const token = await acquireLock(USERS_GUARD_LOCK, 10000, 15000);
  if (!token)
    throw Object.assign(
      new Error("Mutasi pengguna sedang berlangsung; coba lagi."),
      {
        status: 503,
      },
    );
  try {
    // Current admin count for the invariant check happens inside the
    // callback (it knows the proposed change).
    const plan = await propose();
    if (plan.remainingAdmins < 1) throw new LastAdminError();
  } finally {
    await releaseLock(USERS_GUARD_LOCK, token).catch(() => undefined);
  }
}

// Admin-capable accounts after a proposed change: users in
// `overrideRoles` count with their NEW roles, users in `removeIds`
// are gone. Everything else counts as stored.
export async function countAdminsAfter(
  removeIds: string[],
  overrideRoles?: Map<string, string>,
): Promise<number> {
  const adminRoles = await adminRoleSet();
  if (!adminRoles.size) return 0;
  const removed = new Set(removeIds);
  const all = await collections.users
    .find({}, { projection: { _id: 1, roles: 1 } })
    .toArray();
  let count = 0;
  for (const user of all) {
    if (removed.has(user._id)) continue;
    const effective = overrideRoles?.get(user._id) ?? String(user.roles ?? "");
    if (rolesGrantAdmin(effective, adminRoles)) count += 1;
  }
  return count;
}

// Total admin-capable accounts right now.
export async function countAdmins(): Promise<number> {
  const adminRoles = await adminRoleSet();
  if (!adminRoles.size) return 0;
  const all = await collections.users
    .find({}, { projection: { _id: 1, roles: 1 } })
    .toArray();
  return all.filter((u) => rolesGrantAdmin(String(u.roles ?? ""), adminRoles))
    .length;
}

export async function adminRoles(): Promise<Set<string>> {
  return adminRoleSet();
}
