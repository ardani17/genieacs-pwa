import test from "node:test";
import assert from "node:assert/strict";
import Authorizer from "../lib/common/authorizer.ts";
import {
  authorizeAppResource,
  APP_PERMISSION_DOCS,
} from "../lib/ui/app-permissions.ts";

const permissionSet = (resource: string, access: number): never[] =>
  [{ [resource]: { access, filter: null, validate: null } }] as never;

const permissionSetWithFilter = (
  resource: string,
  access: number,
  filter: unknown,
): never[] => [{ [resource]: { access, filter, validate: null } }] as never;

void test("vpn/logs authorization uses native authorizer semantics", () => {
  const admin = new Authorizer([
    permissionSet("vpn", 3),
    permissionSet("logs", 3),
  ]);
  authorizeAppResource(admin, "logs", 3);
  authorizeAppResource(admin, "vpn", 1);
  assert.throws(
    () => authorizeAppResource(admin, "logs", 3, {}, { type: "put" }),
    /FORBIDDEN|validator|rejected/,
  );

  const operator = new Authorizer([permissionSet("vpn", 1)]);
  authorizeAppResource(operator, "vpn", 1);
  assert.throws(() => authorizeAppResource(operator, "vpn", 3), /permission/);
  assert.throws(() => authorizeAppResource(operator, "logs", 3), /permission/);
});

void test("devices permission does not grant vpn/logs", () => {
  const deviceWriter = new Authorizer([permissionSet("devices", 3)]);
  assert.throws(
    () => authorizeAppResource(deviceWriter, "vpn", 1),
    /permission/,
  );
  assert.throws(
    () => authorizeAppResource(deviceWriter, "logs", 3),
    /permission/,
  );
});

void test("deny-filter permissions do not pass hasAccess-only checks", () => {
  // filter: false is an explicit deny even though the access level is
  // sufficient — hasAccess alone would let it through.
  const denied = new Authorizer([
    permissionSetWithFilter("vpn", 3, false),
    permissionSetWithFilter("logs", 3, false),
  ]);
  assert.equal(denied.hasAccess("vpn", 1), true);
  assert.throws(() => authorizeAppResource(denied, "vpn", 1), /filter/);
  assert.throws(() => authorizeAppResource(denied, "logs", 3), /filter/);
});

void test("expression filters are evaluated against the target object", () => {
  // Scoped grant: only the installation object matching the expression
  // is reachable; a non-matching object is denied before any query.
  const scoped = new Authorizer([
    permissionSetWithFilter("vpn", 3, [
      "=",
      ["PARAM", "installation"],
      "lab-a",
    ]),
  ]);
  authorizeAppResource(scoped, "vpn", 1, { installation: "lab-a" });
  assert.throws(
    () => authorizeAppResource(scoped, "vpn", 1, { installation: "lab-b" }),
    /filter/,
  );
  // No object at all (installation-level read): nothing matches, deny.
  assert.throws(() => authorizeAppResource(scoped, "vpn", 1), /filter/);
});

void test("bootstrap docs are idempotent and scoped", () => {
  const ids = APP_PERMISSION_DOCS.map((d) => d._id);
  assert.deepEqual([...new Set(ids)], ids);
  for (const doc of APP_PERMISSION_DOCS)
    assert.ok(
      ["vpn", "logs"].includes(doc.resource) && doc.role.match(/^[a-z]+$/),
    );
});
