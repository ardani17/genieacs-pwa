// Static assertions over the deployment compose files — network
// isolation, port surface, volume and restart/log-rotation policy. Runs
// anywhere the repo (with the dev `yaml` package) is available; no
// docker daemon required.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const compose = YAML.parse(
  readFileSync(path.join(repoRoot, "compose.yaml"), "utf8"),
  { merge: true },
);
const https = YAML.parse(
  readFileSync(path.join(repoRoot, "compose.https.yaml"), "utf8"),
);

const LOGGING_OK = (svc) =>
  svc?.logging?.driver === "json-file" &&
  svc?.logging?.options?.["max-size"] === "10m" &&
  svc?.logging?.options?.["max-file"] === "3";

test("cwmp and fs share the vpn namespace; vpn owns the CPE ports", () => {
  assert.equal(compose.services.cwmp.network_mode, "service:vpn");
  assert.equal(compose.services.fs.network_mode, "service:vpn");
  const vpnPorts = (compose.services.vpn.ports ?? []).map(String);
  assert.ok(vpnPorts.some((p) => p.includes("7547")));
  assert.ok(vpnPorts.some((p) => p.includes("7567")));
  assert.ok(compose.services.vpn.cap_add?.includes("NET_ADMIN"));
  assert.deepEqual(compose.services.vpn.devices, ["/dev/ppp:/dev/ppp"]);
  assert.ok(
    compose.services.vpn.healthcheck,
    "vpn must report state with a reason",
  );
});

test("dashboard services are not on the vpn namespace", () => {
  for (const svc of ["web", "ui", "nbi", "mongo"])
    assert.equal(
      compose.services[svc].network_mode,
      undefined,
      `${svc} must not join the vpn namespace`,
    );
  assert.ok(compose.services.web.networks.includes("app"));
});

test("only web and vpn publish host ports; web defaults to loopback", () => {
  for (const svc of ["ui", "nbi", "mongo", "cwmp", "fs"])
    assert.equal(
      compose.services[svc].ports,
      undefined,
      `${svc} must not publish host ports`,
    );
  const webPorts = (compose.services.web.ports ?? []).map(String);
  assert.ok(webPorts.some((p) => p.includes("127.0.0.1:3000")));
  // Web never depends on vpn health.
  const deps = Object.keys(compose.services.web.depends_on ?? {});
  assert.ok(!deps.includes("vpn"));
});

test("restart policy, log rotation and named volumes everywhere", () => {
  for (const [name, svc] of Object.entries(compose.services)) {
    if (name === "cwmp" || name === "fs") {
      // namespace services inherit engine anchor except depends_on
      assert.equal(svc.restart, "unless-stopped");
    } else {
      assert.equal(svc.restart, "unless-stopped", `${name} restart policy`);
    }
    assert.ok(LOGGING_OK(svc), `${name} log rotation`);
    assert.equal(
      svc.container_name,
      undefined,
      `${name} no fixed container_name`,
    );
  }
  assert.ok(Object.keys(compose.volumes ?? {}).includes("mongo_data"));
  assert.ok(compose.services.mongo.healthcheck);
});

test("mongo requires auth and the engine connects with credentials", () => {
  assert.ok(compose.services.mongo.environment.MONGO_INITDB_ROOT_USERNAME);
  assert.ok(compose.services.mongo.environment.MONGO_INITDB_ROOT_PASSWORD);
  assert.match(
    compose.services.ui.environment.GENIEACS_MONGODB_CONNECTION_URL,
    /mongodb:\/\/\$\{MONGO_USERNAME\}:\$\{MONGO_PASSWORD\}@mongo:27017\/.*authSource=admin/,
  );
});

test("images are digest-pinned", () => {
  const refs = [compose.services.mongo.image, https.services.https.image];
  for (const ref of refs) assert.match(ref, /@sha256:[0-9a-f]{64}/);
});

test("https overlay is read-only with mounted certs and no auto issuance", () => {
  const caddy = https.services.https;
  assert.equal(caddy.read_only, true);
  const mounts = (caddy.volumes ?? []).map(String);
  assert.ok(mounts.some((m) => m.includes("tls.crt") && m.endsWith(":ro")));
  assert.ok(mounts.some((m) => m.includes("tls.key") && m.endsWith(":ro")));
  const caddyfile = readFileSync(
    path.join(repoRoot, "docker", "caddy", "Caddyfile"),
    "utf8",
  );
  assert.ok(caddyfile.includes("auto_https off"));
});

// RE-STD-09B wiring: the engine ui service is a structured-log writer on
// the shared volume, ordered before vector; the e2e overlay exercises
// the same wiring on the test volume.
test("engine ui writes structured logs on the shared volume (RE-STD-09B)", () => {
  const ui = compose.services.ui;
  assert.equal(ui.environment.GENIEACS_UI_APP_LOG_FILE, "/logs/ui/app.ndjson");
  assert.ok(
    (ui.volumes ?? []).some((v) => String(v).startsWith("app_logs:/logs")),
    "ui must mount the shared app_logs volume",
  );
  const vectorDeps = (compose.services.vector.depends_on ?? []).map(String);
  for (const writer of ["ui", "web"])
    assert.ok(
      vectorDeps.includes(writer),
      `vector must start after the ${writer} log writer`,
    );
  assert.ok(vectorDeps.includes("victorialogs"));
});

test("e2e overlay wires the engine writer and its acceptance smoke", () => {
  const e2e = YAML.parse(
    readFileSync(path.join(repoRoot, "compose.e2e.yaml"), "utf8"),
  );
  assert.equal(
    e2e.services.ui.environment.GENIEACS_UI_APP_LOG_FILE,
    "/logs/ui/app.ndjson",
  );
  assert.ok(
    (e2e.services.ui.volumes ?? []).some((v) =>
      String(v).startsWith("app_logs_test:/logs"),
    ),
  );
  const vectorDeps = (e2e.services.vector.depends_on ?? []).map(String);
  for (const writer of ["ui", "web"]) assert.ok(vectorDeps.includes(writer));
  assert.deepEqual(e2e.services["engine-log-smoke"].command, [
    "node",
    "scripts/engine-log-smoke.mjs",
  ]);
});
