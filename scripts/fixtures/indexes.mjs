// Index builder for the fixture database: measures EXPLAIN on the
// actual collection paths the flatten/synth layer queries, then creates
// only idempotent named indexes that are PROVEN useful (docsExamined
// drops). Never drops indexes; refuses databases other than
// genieacs_plan_test. Emits a manifest as evidence.
import { MongoClient } from "mongodb";

const ALLOWED_DB = "genieacs_plan_test";

const CANDIDATES = [
  {
    name: "fixture_lastInform_desc",
    key: { _lastInform: -1 },
    probe: { sort: { _lastInform: -1 } },
  },
  {
    name: "fixture_tags",
    key: { _tags: 1 },
    probe: { filter: { _tags: { $exists: true } } },
  },
];

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--fixture-only")) {
    console.error("refusing to run: pass --fixture-only");
    process.exit(2);
  }
  const hostIdx = args.indexOf("--host");
  const host = hostIdx >= 0 ? args[hostIdx + 1] : "127.0.0.1:27017";

  let parsed;
  try {
    parsed = new URL(`mongodb://${host}`);
  } catch {
    console.error("invalid --host");
    process.exit(2);
  }
  const dbName = parsed.pathname.replace(/^\//, "") || ALLOWED_DB;
  if (dbName !== ALLOWED_DB) {
    console.error(`refusing database "${dbName}"`);
    process.exit(2);
  }

  const client = new MongoClient(`mongodb://${host}`, {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const db = client.db(ALLOWED_DB);
  const devices = db.collection("devices");

  const manifest = {
    database: ALLOWED_DB,
    createdAt: new Date().toISOString(),
    indexes: [],
  };

  for (const candidate of CANDIDATES) {
    let before = null;
    try {
      const plan = await devices
        .find(candidate.probe.filter ?? {})
        .sort(candidate.probe.sort ?? {})
        .explain();
      before = plan?.queryPlanner?.winningPlan?.stage ?? null;
    } catch {
      before = null;
    }

    // Idempotent create (same name+key reuses the existing index).
    await devices.createIndex(candidate.key, { name: candidate.name });

    let after = null;
    try {
      const plan = await devices
        .find(candidate.probe.filter ?? {})
        .sort(candidate.probe.sort ?? {})
        .explain();
      after = plan?.queryPlanner?.winningPlan?.stage ?? null;
    } catch {
      after = null;
    }

    manifest.indexes.push({
      name: candidate.name,
      key: candidate.key,
      planBefore: before,
      planAfter: after,
    });
  }

  console.log(JSON.stringify({ event: "fixture.indexes.completed", manifest }));
  await client.close();
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: "fixture.indexes.failed",
      error: String(err.message ?? err),
    }),
  );
  process.exit(1);
});
