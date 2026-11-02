// Fixture seeder: ONLY --fixture-only, only the test Mongo host and ONLY
// database genieacs_plan_test. Seeds TEST- devices (10000 devices x
// 1000 parameters when fully scaled; the CLI accepts --count) in
// batches of 100 as idempotent upserts. Any other database name is
// refused.
import { MongoClient } from "mongodb";

const ALLOWED_DB = "genieacs_plan_test";

function parseArgs(argv) {
  const args = {
    fixtureOnly: false,
    count: 100,
    host: "127.0.0.1:27017",
    // Fixture Mongo runs WITH auth (compose/test): credentials come
    // from the isolated test environment only, never the operational
    // deployment.
    user: process.env.SEED_USER ?? "",
    password: process.env.SEED_PASSWORD ?? "",
  };
  for (let i = 0; i < argv.length; ++i) {
    const a = argv[i];
    if (a === "--fixture-only") args.fixtureOnly = true;
    else if (a === "--count") args.count = Number(argv[++i]);
    else if (a === "--host") args.host = argv[++i];
    else if (a === "--user") args.user = argv[++i] ?? "";
    else if (a === "--password") args.password = argv[++i] ?? "";
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function param(value) {
  return { _value: value, _type: "xsd:string", _object: false, _timestamp: 1 };
}

function buildDevice(i) {
  const id = `TEST-DEVICE-${String(i).padStart(5, "0")}`;
  const device = {
    _id: id,
    _lastInform: new Date(),
    _registered: new Date(),
    DeviceID: {
      ID: param(id),
      Manufacturer: param("ZTE"),
      ProductClass: param("F670"),
      SerialNumber: param(`TEST-SN-${i}`),
    },
    InternetGatewayDevice: {
      DeviceInfo: { SoftwareVersion: param("V6.0.10P3N19") },
    },
  };
  // ~1000 parameters per device via numbered generic nodes.
  for (let p = 0; p < 250; ++p) {
    device[`Device.Test.Param${p}`] = param(`value-${i}-${p}`);
    device[`Device.Test.Info${p}`] = param(`info-${i}-${p}`);
    device[`Device.Test.Metric${p}`] = {
      _value: p,
      _type: "xsd:int",
      _object: false,
      _timestamp: 1,
    };
    device[`Device.Test.Flag${p}`] = {
      _value: p % 2 === 0,
      _type: "xsd:boolean",
      _object: false,
      _timestamp: 1,
    };
  }
  return device;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixtureOnly) {
    console.error(
      "refusing to run: pass --fixture-only (this seeder never targets real data)",
    );
    process.exit(2);
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 10000) {
    console.error("--count must be 1..10000");
    process.exit(2);
  }

  const url = `mongodb://${args.host}/${ALLOWED_DB}`;
  let parsed;
  try {
    parsed = new URL(`mongodb://${args.host}`);
  } catch {
    console.error("invalid --host");
    process.exit(2);
  }
  const dbName = parsed.pathname.replace(/^\//, "") || ALLOWED_DB;
  if (dbName !== ALLOWED_DB) {
    console.error(
      `refusing database "${dbName}": only ${ALLOWED_DB} is allowed`,
    );
    process.exit(2);
  }
  void url;

  // Auth (when configured) always targets the admin source the
  // fixture container provisions; the database stays genieacs_plan_test.
  const credentials = args.user
    ? encodeURIComponent(args.user) +
      ":" +
      encodeURIComponent(args.password) +
      "@"
    : "";
  const client = new MongoClient(
    `mongodb://${credentials}${args.host}/?authSource=admin`,
    { serverSelectionTimeoutMS: 5000 },
  );
  await client.connect();
  const db = client.db(ALLOWED_DB);
  const devices = db.collection("devices");

  let inserted = 0;
  const BATCH = 100;
  for (let start = 0; start < args.count; start += BATCH) {
    const batch = [];
    for (let i = start; i < Math.min(start + BATCH, args.count); ++i)
      batch.push({
        replaceOne: {
          filter: { _id: `TEST-DEVICE-${String(i).padStart(5, "0")}` },
          replacement: buildDevice(i),
          upsert: true,
        },
      });
    const res = await devices.bulkWrite(batch, { ordered: true });
    inserted += res.upsertedCount + res.matchedCount;
  }

  console.log(
    JSON.stringify({
      event: "fixture.seed.completed",
      devices: args.count,
      operations: inserted,
    }),
  );
  await client.close();
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: "fixture.seed.failed",
      error: String(err.message ?? err),
    }),
  );
  process.exit(1);
});
