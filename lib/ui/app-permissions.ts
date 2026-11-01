// App resource authorization for vpn/logs: uses the NATIVE Authorizer
// semantics (hasAccess + getFilter + getValidator) on installation-level
// pseudo resources. Roles never receive silent grants — the permission
// documents must exist (the seed adds them for the bootstrap admin).

import Authorizer from "../common/authorizer.ts";

export const APP_RESOURCES = ["vpn", "logs"] as const;
export type AppResource = (typeof APP_RESOURCES)[number];

export class AppPermissionError extends Error {
  code = "FORBIDDEN";

  constructor(message: string) {
    super(message);
    this.name = "Error";
  }
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
