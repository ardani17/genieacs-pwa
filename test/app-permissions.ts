import test from "node:test";
import assert from "node:assert/strict";
import Authorizer from "../lib/common/authorizer.ts";
import {
  authorizeAppResource,
  APP_PERMISSION_DOCS,
} from "../lib/ui/app-permissions.ts";

const permissionSet = (resource: string, access: number): never[] =>
  [{ [resource]: { access, filter: null, validate: null } }] as never;

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

void test("bootstrap docs are idempotent and scoped", () => {
  const ids = APP_PERMISSION_DOCS.map((d) => d._id);
  assert.deepEqual([...new Set(ids)], ids);
  for (const doc of APP_PERMISSION_DOCS)
    assert.ok(
      ["vpn", "logs"].includes(doc.resource) && doc.role.match(/^[a-z]+$/),
    );
});
