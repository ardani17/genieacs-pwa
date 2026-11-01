import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosticTarget,
  runDeviceDiagnostics,
} from "../lib/ui/device-diagnostics.ts";

void test("diagnostic target comes from device, never request hostname", () => {
  assert.throws(() => diagnosticTarget({} as never), /VALIDATION/);
  const target = diagnosticTarget({
    "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
      value: ["http://192.0.2.10:7547/", "xsd:string"],
    },
  });
  assert.equal(target.host, "192.0.2.10");
  assert.equal(target.port, 7547);
});

void test("IPv6 CR URLs parse; malformed ones fail closed", () => {
  const v6 = diagnosticTarget({
    "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
      value: ["http://[2001:db8::1]:7547/", "xsd:string"],
    },
  });
  assert.equal(v6.host, "2001:db8::1");
  assert.equal(v6.port, 7547);

  // Default ports per scheme.
  const https = diagnosticTarget({
    "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
      value: ["https://example.invalid/", "xsd:string"],
    },
  });
  assert.equal(https.port, 443);

  assert.throws(
    () =>
      diagnosticTarget({
        "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
          value: ["not a url", "xsd:string"],
        },
      }),
    /VALIDATION/,
  );
});

void test("without a controller the check is unavailable, never a scan", async () => {
  const result = await runDeviceDiagnostics(
    {
      "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
        value: ["http://192.0.2.10:7547/", "xsd:string"],
      },
    },
    false,
  );
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].status, "unavailable");
  assert.match(result.checks[0].evidence ?? "", /controller/);
});

void test("devices without a CR URL report a safe limitation", async () => {
  const result = await runDeviceDiagnostics({}, false);
  assert.equal(result.checks[0].status, "unavailable");
  assert.ok(result.checks[0].evidence?.includes("connection request"));
  assert.equal(result.checks[0].target, null);
});

void test("with a controller, TCP connect runs against the device target only", async () => {
  // Loopback listener as the authorized target.
  const net = await import("node:net");
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const result = await runDeviceDiagnostics(
    {
      "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
        value: [`http://127.0.0.1:${port}/`, "xsd:string"],
      },
    },
    true,
  );
  assert.equal(result.checks[0].status, "ok");
  assert.ok((result.checks[0].durationMs ?? 0) >= 0);

  // Timeout path: a black-holed TEST-NET address can't connect.
  const refused = await runDeviceDiagnostics(
    {
      "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": {
        value: ["http://192.0.2.254:81/", "xsd:string"],
      },
    },
    true,
  );
  assert.ok(["unreachable", "timeout"].includes(refused.checks[0].status));

  await new Promise<void>((r) => server.close(() => r()));
});
