import type { SessionDTO } from "@contracts/api.ts";

// Native Authorizer returns one array of permission records per role.
// This drives visibility only; the engine still authorizes each request.
export function hasResourceAccess(
  session: Pick<SessionDTO, "permissionSets">,
  resource: string,
  minAccess: number,
): boolean {
  return session.permissionSets.some((set) =>
    set.some((record) => (record[resource]?.access ?? 0) >= minAccess),
  );
}
