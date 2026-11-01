// Security-alert test runner for the network-less sandbox container.
//
//   node /source/scripts/security/check-alerts.mjs <ALERT-SUITE-ID>
//
// Bundles the suite's TypeScript tests with the repository's own esbuild
// into the tmpfs scratch directory and runs `node --test` with a 15s
// per-test timeout and a 30s wall clock per suite. No package installs,
// no network, no database: suites must use dummy state and loopback only.
// Output is capped at 5MiB; exit code mirrors the child's.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "/tools/node_modules/esbuild/lib/main.js";

const SOURCE_ROOT = "/source";
const SCRATCH_ROOT = "/scratch/alert-tests";
const TEST_TIMEOUT_MS = 15_000;
const SUITE_WALL_MS = 30_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

// One entry per alert package; later packages append their suites here.
const ALERT_SUITES = {
  "M01-S9": ["scripts/security/github-alert-gate.test.mjs"],
  "M01-S8": [
    "test/security/xmpp-scram.ts",
    "test/security/xmpp-negotiation.ts",
  ],
  "M01-S7": ["test/security/udp-cr-auth.ts"],
  "M01-S6": ["test/security/http-digest.ts"],
  "M01-S5": ["test/security/cwmp-cookie.ts"],
  "M01-S4": [
    "test/security/expression-parser.ts",
    "test/security/like-pattern.ts",
  ],
  "M01-S3": ["test/security/escaping.ts", "test/security/error-response.ts"],
  "M01-S2": ["test/security/nbi-query.ts", "test/security/nbi-route.ts"],
  "M01-S1": [
    "test/security/script-validation.ts",
    "test/security/script-permissions.ts",
  ],
};

const [suiteId] = process.argv.slice(2);
if (!suiteId) {
  process.stderr.write("usage: check-alerts.mjs <ALERT-SUITE-ID>\n");
  process.exit(2);
}
const sources = ALERT_SUITES[suiteId];
if (!sources || sources.length === 0) {
  process.stderr.write(
    `UNKNOWN_SUITE: "${suiteId}" (known: ${Object.keys(ALERT_SUITES).join(", ") || "none"})\n`,
  );
  process.exit(2);
}

const outDir = path.join(SCRATCH_ROOT, suiteId);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const outputs = [];
for (const source of sources) {
  const abs = path.join(SOURCE_ROOT, source);
  const rel = path.relative(SOURCE_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    process.stderr.write(`INVALID_INPUT: "${source}" escapes /source\n`);
    process.exit(2);
  }
  if (!statSync(abs).isFile()) {
    process.stderr.write(`MISSING_TEST: "${source}"\n`);
    process.exit(2);
  }
  const out = path.join(outDir, rel.replace(/\.tsx?$/, "") + ".test.cjs");
  mkdirSync(path.dirname(out), { recursive: true });
  buildSync({
    entryPoints: [abs],
    bundle: true,
    platform: "node",
    target: "node24",
    packages: "external",
    format: "cjs",
    sourcemap: "inline",
    outfile: out,
    absWorkingDir: SOURCE_ROOT,
    logLevel: "warning",
  });
  outputs.push(out);
}

const child = spawnSync(
  process.execPath,
  ["--test", `--test-timeout=${TEST_TIMEOUT_MS}`, ...outputs],
  {
    cwd: SOURCE_ROOT,
    shell: false,
    encoding: "utf8",
    timeout: SUITE_WALL_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV ?? "test",
      CI: process.env.CI ?? "1",
      HOME: process.env.HOME ?? "/scratch/home",
      TMPDIR: process.env.TMPDIR ?? "/scratch/tmp",
      NODE_PATH: "/tools/node_modules",
    },
  },
);

const truncate = (text) =>
  text && text.length > MAX_OUTPUT_BYTES
    ? text.slice(0, MAX_OUTPUT_BYTES) + "\n[output truncated at 5MiB]\n"
    : (text ?? "");

process.stdout.write(truncate(child.stdout));
process.stderr.write(truncate(child.stderr));

if (child.error) {
  process.stderr.write(`SUITE_ERROR: ${child.error.message}\n`);
  process.exit(1);
}
if (child.signal) {
  process.stderr.write(`SUITE_TIMEOUT: killed by ${child.signal}\n`);
  process.exit(1);
}
process.exit(child.status ?? 1);
