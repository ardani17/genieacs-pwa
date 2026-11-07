// TypeScript test runner: node scripts/test-ts.mjs <test-file.ts...>
//
// Bundles each root-level TS test with esbuild (platform node, node24
// target, packages external, CJS output) into artifacts/tests, then runs
// `node --test` on the bundled files and propagates the child exit code.
// Inputs must live inside the repository; outputs are confined to
// artifacts/tests. Keeps upstream's bundle-then-test flow but without
// writing transient .js files next to the sources.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outRoot = path.join(repoRoot, "artifacts", "tests");

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  process.stderr.write("usage: node scripts/test-ts.mjs <test-file.ts...>\n");
  process.exit(2);
}

function resolveInsideRepo(rel) {
  const abs = path.resolve(repoRoot, rel);
  const relFromRoot = path.relative(repoRoot, abs);
  if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
    throw new Error(`input "${rel}" escapes the repository`);
  }
  return abs;
}

const outputs = [];
for (const input of inputs) {
  const abs = resolveInsideRepo(input);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    process.stderr.write(`input "${input}" is not a file\n`);
    process.exit(2);
  }
  const relFromRoot = path.relative(repoRoot, abs);
  const out = path.join(
    outRoot,
    relFromRoot.replace(/\.tsx?$/, "") + ".test.cjs",
  );
  outputs.push(out);
}

for (const [index, abs] of inputs.map((f, i) => [i, resolveInsideRepo(f)])) {
  const out = outputs[index];
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
    logLevel: "warning",
  });
}

const child = spawnSync(process.execPath, ["--test", ...outputs], {
  cwd: repoRoot,
  shell: false,
  stdio: "inherit",
  env: process.env,
});
if (child.error) {
  process.stderr.write(`failed to run node --test: ${child.error.message}\n`);
  process.exit(1);
}
process.exit(child.status ?? 1);
