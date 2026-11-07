#!/usr/bin/env node
// Idempotent config/preset seeder (M06-C). Modes:
//   bootstrap — write defaults that do not exist yet; existing values
//               are NEVER overwritten (status: skipped-existing).
//   preview   — compute the plan, write nothing.
// Per-item results are printed as JSON; a nonzero exit code means an
// internal error, never a conflict (conflicts are normal output).
import { readFileSync } from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const REQUIRED_DB = "genieacs_plan_test";

function loadSeed(dir) {
  const ui = JSON.parse(
    readFileSync(path.join(dir, "config/seed/ui.json"), "utf8"),
  );
  const presets = JSON.parse(
    readFileSync(path.join(dir, "config/seed/presets.json"), "utf8"),
  );
  return { ui, presets };
}

export function planSeed(seed) {
  const items = [];
  for (const [key, doc] of Object.entries(seed.ui.config ?? {}))
    items.push({ kind: "config", key, doc });
  for (const [key, doc] of Object.entries(seed.presets.presets ?? {}))
    items.push({ kind: "presets", key, doc });
  // Guardrail: never seed anything that looks like a credential or the
  // inactive useradmin preset.
  for (const item of items) {
    if (/password|secret|token|credential/i.test(item.key))
      throw new Error(`seed contains credential-looking key: ${item.key}`);
    if (item.key === "useradmin")
      throw new Error("useradmin preset must never be seeded");
  }
  return items;
}

export async function seedConfig({ mode, seed, client }) {
  const results = [];
  const db = client.db();
  for (const item of planSeed(seed)) {
    const collection = db.collection(item.kind);
    const existing = await collection.findOne({ _id: item.key });
    if (existing) {
      results.push({ key: item.key, status: "skipped-existing" });
      continue;
    }
    if (mode === "preview") {
      results.push({ key: item.key, status: "would-create" });
      continue;
    }
    try {
      await collection.insertOne({ _id: item.key, ...item.doc });
      results.push({ key: item.key, status: "created" });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // A concurrent seeder created it first: classify without writing.
      const winner = await collection.findOne({ _id: item.key });
      results.push({
        key: item.key,
        status:
          JSON.stringify(winner) ===
          JSON.stringify({ _id: item.key, ...item.doc })
            ? "skipped-existing"
            : "conflict",
      });
    }
  }
  return results;
}

async function main() {
  const mode = process.argv[2] === "preview" ? "preview" : "bootstrap";
  const url =
    process.env.MONGO_URL ?? `mongodb://127.0.0.1:27017/${REQUIRED_DB}`;
  const parsed = new URL(url);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (dbName !== REQUIRED_DB) {
    process.stderr.write(
      `refusing database "${dbName}": only ${REQUIRED_DB}\n`,
    );
    process.exit(2);
  }
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const seed = loadSeed(process.cwd());
    const results = await seedConfig({ mode, seed, client });
    process.stdout.write(JSON.stringify({ mode, results }, null, 1) + "\n");
  } finally {
    await client.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("seed-config.mjs"))
  void main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
