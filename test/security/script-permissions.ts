import test from "node:test";
import assert from "node:assert/strict";
import Authorizer from "../../lib/common/authorizer.ts";
import type { PermissionSet } from "../../lib/types.ts";

// Dummy principals: a write-capable admin and an operator whose permission
// sets grant no provision/virtual-parameter access. local-cache builds
// PermissionSets as Object.values(permissions[role]) — an ARRAY of
// per-access-level resource maps — so the fixture mirrors that shape.
const permissionSet = (resource: string, access: number): PermissionSet =>
  [
    { [resource]: { access, filter: null, validate: null } },
  ] as unknown as PermissionSet;

void test("operators without write permission are denied before parse or store", () => {
  const operator = new Authorizer([
    permissionSet("devices", 2),
    permissionSet("provisions", 2),
  ]);
  assert.equal(operator.hasAccess("provisions", 3), false);
  assert.equal(operator.hasAccess("virtualParameters", 3), false);

  // The API route order is: hasAccess(3) -> getValidator -> putResource
  // (which validates syntax). Denial at the first gate means untrusted
  // script content is never parsed with attacker-controlled input.
  const admin = new Authorizer([
    permissionSet("provisions", 3),
    permissionSet("virtualParameters", 3),
  ]);
  assert.equal(admin.hasAccess("provisions", 3), true);
});

void test("validator gates run before store for permission sets with validate", () => {
  // Permissions store validate as an expression string; local-cache
  // parses it ("true" -> the boolean literal true).
  const restricted = new Authorizer([
    [
      { provisions: { access: 3, filter: null, validate: true } },
    ] as unknown as PermissionSet,
  ]);
  const validate = restricted.getValidator("provisions", {
    _id: "fixture",
    script: "1;",
  });
  assert.equal(typeof validate, "function");
  assert.equal(validate("put", { script: "1;" }), true);
});
