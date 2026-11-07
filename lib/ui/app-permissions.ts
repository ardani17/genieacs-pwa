// App resource authorization for vpn/logs: uses the NATIVE Authorizer
// semantics (hasAccess + getFilter + getValidator) on installation-level
// pseudo resources. Roles never receive silent grants — the permission
// documents must exist (the seed adds them for the bootstrap admin).

import Authorizer from "../common/authorizer.ts";
import { evaluate, or } from "../common/expression/util.ts";
import type { Expression } from "../types.ts";

export const APP_RESOURCES = ["vpn", "logs"] as const;
export type AppResource = (typeof APP_RESOURCES)[number];

export class AppPermissionError extends Error {
  code = "FORBIDDEN";

  constructor(message: string) {
    super(message);
    this.name = "Error";
  }
}

function evaluateFilter(filter: Expression, object: unknown): boolean {
  // PARAM references resolve against the installation/target object;
  // missing values evaluate falsy, so an expression-scoped permission
  // never grants reads that have no matching object.
  const res = evaluate(
    filter,
    (object ?? {}) as Record<string, unknown>,
    Date.now(),
  );
  return !Array.isArray(res) && !!res;
}

export function authorizeAppResource(
  authorizer: Authorizer,
  resource: AppResource,
  access: 1 | 2 | 3,
  object?: unknown,
  mutation?: { type: string; args?: unknown },
): void {
  if (!authorizer.hasAccess(resource, access))
    throw new AppPermissionError(`no ${resource}:${access} permission`);

  // The NATIVE filter is part of the permission, not optional. The
  // authorizer's aggregated getFilter() loses a lone boolean-deny
  // permission (or(null, false) collapses to null), so the granting
  // permission sets are combined here with the deny intact: any
  // unrestricted grant allows, otherwise the OR of the scoped filters
  // must evaluate truthy against the installation/target object.
  const sets = authorizer.getPermissionSets();
  let unrestricted = false;
  const scoped: Expression[] = [];
  for (const permissionSet of sets) {
    for (const perm of permissionSet) {
      const p = perm[resource];
      if (!p || p.access < access) continue;
      if (p.filter == null || p.filter === true) unrestricted = true;
      else scoped.push(p.filter);
    }
  }

  if (!unrestricted) {
    const everyDeny = scoped.length > 0 && scoped.every((f) => f === false);
    const combined = scoped.reduce<Expression | null>(
      (acc, e) => or(acc, e),
      null,
    );
    if (everyDeny || combined == null || !evaluateFilter(combined, object))
      throw new AppPermissionError(
        `${resource}:${access} filter denies access`,
      );
  }

  if (mutation) {
    const validate = authorizer.getValidator(resource, object);
    if (!validate(mutation.type, mutation.args))
      throw new AppPermissionError(`validator rejected ${resource} mutation`);
  }
}

// Bootstrap permission documents for the installation resources (admin
// vpn:3, logs:3). Idempotent — existing documents are left untouched so
// no silent grants or overwrites happen.
export const APP_PERMISSION_DOCS = [
  {
    _id: "admin:vpn:3",
    role: "admin",
    resource: "vpn",
    access: 3,
    validate: "true",
  },
  {
    _id: "admin:logs:3",
    role: "admin",
    resource: "logs",
    access: 3,
    validate: "true",
  },
  {
    _id: "operator:vpn:1",
    role: "operator",
    resource: "vpn",
    access: 1,
    validate: "true",
  },
] as const;
