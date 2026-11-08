// E2E fixture seeder for the browser-test stack: seeds the identity
// fixtures (native pbkdf2 password hashes, permission documents) and a
// handful of TEST- devices — including a secret parameter the masking
// assertions expect — into the throwaway genieacs_plan_test database.
// Refuses to run against anything else; credentials come from the
// isolated test environment only.
import { pbkdf2, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const ALLOWED_DB = "genieacs_plan_test";
const FIXTURE_PASSWORD = "Fixture-Only-2026!";

function hashPassword(pass, salt) {
  return new Promise((resolve, reject) =>
    pbkdf2(pass, salt, 10000, 128, "sha512", (err, hash) =>
      err ? reject(err) : resolve(hash.toString("hex")),
    ),
  );
}

function param(value, type = "xsd:string", writable = false) {
  return {
    _value: value,
    _type: type,
    _writable: writable,
    _object: false,
    _timestamp: 1,
  };
}

function buildDevice(i) {
  const firmware = i === 2 ? "unknown-version" : "V6.0.10P3N19";
  return {
    _id: `TEST-DEVICE-${String(i).padStart(5, "0")}`,
    _lastInform: new Date(),
    _registered: new Date(),
    _tags: ["demo", "fixture-a\\b"],
    _deviceId: {
      _Manufacturer: "ZTE",
      _OUI: "000000",
      _ProductClass: "F670",
      _SerialNumber: `TEST-SN-${i}`,
    },
    DeviceID: {
      ID: param(`TEST-DEVICE-${String(i).padStart(5, "0")}`),
      Manufacturer: param("ZTE"),
      ProductClass: param("F670"),
      SerialNumber: param(`TEST-SN-${i}`),
    },
    InternetGatewayDevice: {
      DeviceInfo: { SoftwareVersion: param(firmware) },
      ManagementServer: {
        // TEST-NET host: never the device's WAN IP, so the management
        // WAN guard keeps this instance editable in e2e flows.
        ConnectionRequestURL: param("http://192.0.2.99:7547/"),
      },
      LANDevice: {
        1: {
          WLANConfiguration: {
            2: {
              SSID: param("Lab", "xsd:string", true),
              Enable: param(true, "xsd:boolean", true),
              Standard: param("802.11b/g/n"),
              BeaconType: param("11i"),
              "PreSharedKey.1.PreSharedKey": param("", "xsd:string", true),
            },
          },
        },
      },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                _writable: true,
                1: {
                  Name: param("INTERNET", "xsd:string", true),
                  Enable: param(true, "xsd:boolean", true),
                  ConnectionType: param("IP_Routed", "xsd:string", true),
                  PossibleConnectionTypes: param(
                    "IP_Routed,PPPoE_Bridged",
                    "xsd:string",
                    false,
                  ),
                  "X_ZTE-COM_ServiceList": param(
                    "INTERNET",
                    "xsd:string",
                    true,
                  ),
                  "X_ZTE-COM_VLANEnable": param(0, "xsd:unsignedInt", true),
                  "X_ZTE-COM_VLANID": param(0, "xsd:unsignedInt", true),
                  "X_ZTE-COM_8021P": param(0, "xsd:unsignedInt", true),
                  NATEnabled: param(true, "xsd:boolean", true),
                  AddressingType: param("DHCP", "xsd:string", true),
                  ExternalIPAddress: param("192.0.2.50"),
                  SubnetMask: param("0.0.0.0"),
                  DefaultGateway: param("0.0.0.0"),
                  DNSServers: param("", "xsd:string", true),
                  "X_ZTE-COM_LanInterface": param("", "xsd:string", true),
                },
              },
              WANPPPConnection: {
                _writable: true,
                1: {
                  Name: param("PPPoE", "xsd:string", true),
                  Enable: param(false, "xsd:boolean", true),
                  ConnectionType: param("PPPoE_Routed", "xsd:string", true),
                  PossibleConnectionTypes: param(
                    "PPPoE_Routed,PPPoE_Bridged",
                    "xsd:string",
                    false,
                  ),
                  "X_ZTE-COM_ServiceList": param("", "xsd:string", true),
                  "X_ZTE-COM_VLANEnable": param(0, "xsd:unsignedInt", true),
                  "X_ZTE-COM_VLANID": param(0, "xsd:unsignedInt", true),
                  "X_ZTE-COM_8021P": param(0, "xsd:unsignedInt", true),
                  NATEnabled: param(true, "xsd:boolean", true),
                  Username: param("", "xsd:string", true),
                  Password: param("", "xsd:string", true),
                  "X_ZTE-COM_LanInterface": param("", "xsd:string", true),
                },
              },
            },
          },
        },
      },
    },
    // The e2e masking assertions look for this sentinel parameter.
    "Device.WiFi.KeyPassphrase": param("e2e-secret-passphrase"),
  };
}

async function main() {
  const host = process.env.SEED_HOST ?? "127.0.0.1:27017";
  const user = process.env.SEED_USER ?? "";
  const password = process.env.SEED_PASSWORD ?? "";

  const parsed = new URL(`mongodb://${host}`);
  const dbName = parsed.pathname.replace(/^\//, "") || ALLOWED_DB;
  if (dbName !== ALLOWED_DB) {
    console.error(`refusing database "${dbName}": only ${ALLOWED_DB}`);
    process.exit(2);
  }

  const identities = JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../test/fixtures/identities.json",
      ),
      "utf8",
    ),
  );

  const credentials = user
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
    : "";
  const client = new MongoClient(
    `mongodb://${credentials}${host}/?authSource=admin`,
    { serverSelectionTimeoutMS: 5000 },
  );
  await client.connect();
  const db = client.db(ALLOWED_DB);

  const salt = randomBytes(16).toString("hex");
  const hash = await hashPassword(FIXTURE_PASSWORD, salt);

  const users = Object.entries(identities.users).map(([username, role]) => ({
    _id: username,
    password: hash,
    salt,
    roles: role,
  }));
  await db.collection("users").deleteMany({});
  await db.collection("users").insertMany(users);

  await db.collection("permissions").deleteMany({});
  const permissions = Object.entries(identities.roles).flatMap(([role, def]) =>
    def.resources.map((resource) => ({
      _id: `${role}:${resource}:${def.access}`,
      role,
      resource,
      access: def.access,
      validate: "true",
    })),
  );
  permissions.push(
    {
      _id: "fixtureAdmin:vpn:3",
      role: "fixtureAdmin",
      resource: "vpn",
      access: 3,
      validate: "true",
    },
    {
      _id: "fixtureAdmin:logs:3",
      role: "fixtureAdmin",
      resource: "logs",
      access: 3,
      validate: "true",
    },
    {
      _id: "fixtureOperator:vpn:1",
      role: "fixtureOperator",
      resource: "vpn",
      access: 1,
      validate: "true",
    },
  );
  await db.collection("permissions").insertMany(permissions);

  await db.collection("devices").deleteMany({});
  await db
    .collection("devices")
    .insertMany(Array.from({ length: 3 }, (_, i) => buildDevice(i)));

  console.log(
    JSON.stringify({
      event: "e2e.seed.completed",
      users: users.length,
      permissions: permissions.length,
      devices: 3,
    }),
  );
  await client.close();
}

main().catch((err) => {
  console.error(
    JSON.stringify({ event: "e2e.seed.failed", error: String(err.message) }),
  );
  process.exit(1);
});
