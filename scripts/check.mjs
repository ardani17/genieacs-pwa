// Package verification runner: node scripts/check.mjs <package-id|all>
//
// Executes the concrete commands registered in scripts/check-suites.json.
// Commands are spawned as argv without a shell, with a cwd pinned inside
// the repository. The run fails fast on the first nonzero child, on an
// unknown package id (UNKNOWN_SUITE) and on missing/empty required
// artifacts (MISSING_EVIDENCE). Exit code 0 means every command succeeded
// and every required artifact exists.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const suitesFile = path.join(repoRoot, "scripts", "check-suites.json");

const REQUIRED_TEST_DATABASE = "genieacs_plan_test";

function fail(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(2);
}

// All mutating/verification work must target the throwaway check project
// database. A MONGO_URL pointing anywhere else is a misconfiguration, not a
// skipped warning.
if (process.env.MONGO_URL) {
  let url;
  try {
    url = new URL(process.env.MONGO_URL);
  } catch {
    fail("INVALID_MONGO_URL", "MONGO_URL is not a valid URL");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database !== REQUIRED_TEST_DATABASE) {
    fail(
      "INVALID_TEST_DATABASE",
      `MONGO_URL must select database "${REQUIRED_TEST_DATABASE}", got "${database}"`,
    );
  }
}

const [selector] = process.argv.slice(2);
if (!selector) {
  fail(
    "USAGE",
    "usage: node scripts/check.mjs <package-id|all> (ids come from scripts/check-suites.json)",
  );
}

let suites;
try {
  suites = JSON.parse(readFileSync(suitesFile, "utf8"));
} catch (err) {
  fail(
    "UNKNOWN_SUITE",
    `cannot read ${path.relative(repoRoot, suitesFile)}: ${err.message}`,
  );
}

const ids = selector === "all" ? Object.keys(suites) : [selector];
for (const id of ids) {
  if (!Object.hasOwn(suites, id)) {
    fail(
      "UNKNOWN_SUITE",
      `"${id}" is not registered in scripts/check-suites.json (known: ${Object.keys(suites).join(", ") || "none"})`,
    );
  }
}

function resolveInsideRepo(rel) {
  const abs = path.resolve(repoRoot, rel ?? ".");
  const relFromRoot = path.relative(repoRoot, abs);
  if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
    fail("INVALID_CWD", `suite cwd "${rel}" escapes the repository`);
  }
  return abs;
}

for (const id of ids) {
  const steps = suites[id];
  if (!Array.isArray(steps) || steps.length === 0) {
    fail("UNKNOWN_SUITE", `suite "${id}" must be a non-empty array of steps`);
  }

  for (const [index, step] of steps.entries()) {
    const label = `${id}[${index}]`;
    if (!step || typeof step.command !== "string" || !step.command) {
      fail("UNKNOWN_SUITE", `suite step ${label} has no command`);
    }
    if (
      !Array.isArray(step.args) ||
      step.args.some((a) => typeof a !== "string")
    ) {
      fail(
        "UNKNOWN_SUITE",
        `suite step ${label} args must be an array of strings`,
      );
    }

    const cwd = resolveInsideRepo(step.cwd);
    const child = spawnSync(step.command, step.args, {
      cwd,
      shell: false,
      stdio: "inherit",
      env: process.env,
    });
    if (child.error) {
      fail(
        "COMMAND_FAILED",
        `suite step ${label} could not run: ${child.error.message}`,
      );
    }
    if (child.status !== 0) {
      process.exit(child.status ?? 1);
    }

    const artifacts = Array.isArray(step.artifacts) ? step.artifacts : [];
    for (const artifactRel of artifacts) {
      const artifactPath = resolveInsideRepo(artifactRel);
      if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
        fail(
          "MISSING_EVIDENCE",
          `suite step ${label} required artifact "${artifactRel}" was not produced`,
        );
      }
      if (statSync(artifactPath).size === 0) {
        fail(
          "MISSING_EVIDENCE",
          `suite step ${label} required artifact "${artifactRel}" is empty`,
        );
      }
    }
  }
  process.stdout.write(`suite ${id}: PASS\n`);
}
