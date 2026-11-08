import test from "node:test";
import assert from "node:assert/strict";
import { internalServiceUrl } from "../lib/common/internal-url.ts";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  controllerRequest,
  ControllerError,
} from "../lib/ui/vpn-controller.ts";

void test("internal service URLs keep fixed requests at the configured origin", () => {
  assert.equal(
    internalServiceUrl("http://vpn:8787", "/status"),
    "http://vpn:8787/status",
  );
  assert.equal(
    internalServiceUrl("https://ui.internal/", "/api/internal/vpn/profile"),
    "https://ui.internal/api/internal/vpn/profile",
  );
  for (const origin of [
    "file:///etc/passwd",
    "http://user:pass@vpn:8787",
    "http://vpn:8787?token=x",
    "http://vpn:8787#x",
    "http://vpn:8787/prefix",
  ]) {
    assert.throws(() => internalServiceUrl(origin, "/status"));
  }
  for (const path of [
    "//other/status",
    "/\\other/status",
    "https://other/status",
  ])
    assert.throws(() => internalServiceUrl("http://vpn:8787", path));
});

void test("controller bearer requests reject redirects before a second request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "controller-redirect-"));
  const tokenPath = join(dir, "token");
  await writeFile(tokenPath, "fixture-controller-token", {
    mode: 0o600,
    flag: "wx",
  });
  const previous = {
    VPN_CONTROLLER_URL: process.env.VPN_CONTROLLER_URL,
    VPN_CONTROLLER_TOKEN_FILE: process.env.VPN_CONTROLLER_TOKEN_FILE,
    ACS_ADDRESS_TOKEN_FILE: process.env.ACS_ADDRESS_TOKEN_FILE,
  };
  let calls = 0;
  let authenticated = false;
  const server = createServer((req, res) => {
    calls++;
    authenticated =
      req.headers.authorization === "Bearer fixture-controller-token";
    res.writeHead(302, { Location: "/redirect-target" });
    res.end();
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    process.env.VPN_CONTROLLER_URL = `http://127.0.0.1:${address.port}`;
    process.env.VPN_CONTROLLER_TOKEN_FILE = tokenPath;
    delete process.env.ACS_ADDRESS_TOKEN_FILE;
    await assert.rejects(controllerRequest("/status"), ControllerError);
    assert.equal(calls, 1);
    assert.equal(authenticated, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
});
