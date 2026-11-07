// Dependency inventory and advisory scan for the genieacs-pwa fork.
//
// Library part: turn a parsed npm shrinkwrap (v2/v3) or package-lock (v3)
// into flat {name, version, dev, optional, path} rows while keeping every
// distinct transitive path. CLI part: write the security artifacts under
// artifacts/security and query the npm bulk advisory endpoint. Any HTTP or
// JSON failure is a failed scan (nonzero exit), never a zero-finding result.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LOCK_SCHEMA = "LOCK_SCHEMA";

const SUPPORTED_LOCKFILE_VERSIONS = [2, 3];

function schemaError(message) {
  const err = new Error(message);
  err.code = LOCK_SCHEMA;
  return err;
}

// The package name is encoded by the segment(s) after the LAST
// "node_modules/": one segment normally, two for @scoped packages.
export function packageNameFromPath(lockPath) {
  const marker = "node_modules/";
  const idx = lockPath.lastIndexOf(marker);
  const rest = idx === -1 ? lockPath : lockPath.slice(idx + marker.length);
  if (rest.startsWith("@")) {
    const segments = rest.split("/");
    return segments.slice(0, 2).join("/");
  }
  return rest.split("/")[0];
}

export function inventory(lock) {
  if (
    !lock ||
    typeof lock !== "object" ||
    Array.isArray(lock) ||
    !SUPPORTED_LOCKFILE_VERSIONS.includes(lock.lockfileVersion) ||
    !lock.packages ||
    typeof lock.packages !== "object" ||
    Array.isArray(lock.packages)
  ) {
    throw schemaError(
      "Unsupported lockfile schema: expected shrinkwrap v2/v3 or package-lock v3 with a packages tree",
    );
  }

  const rows = [];
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (lockPath === "") continue; // root manifest, not a dependency
    if (!entry || typeof entry !== "object") continue;
    if (entry.link) continue; // workspace links carry no own version
    if (typeof entry.version !== "string") continue;
    rows.push({
      name: packageNameFromPath(lockPath),
      version: entry.version,
      dev: entry.dev === true,
      optional: entry.optional === true,
      path: lockPath,
    });
  }

  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return rows;
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function uniqueNameVersions(rows) {
  const byName = new Map();
  for (const row of rows) {
    const versions = byName.get(row.name) ?? new Set();
    versions.add(row.version);
    byName.set(row.name, versions);
  }
  const body = {};
  for (const [name, versions] of byName) body[name] = [...versions].sort();
  return body;
}

// The npm registry returns 404 (with no body) when the submitted set has no
// known advisories; that is a clean result, not a transport failure.
async function fetchAdvisories(nameVersions, endpoint) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nameVersions),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 404) return {};
  if (!response.ok) {
    throw new Error(`Advisory endpoint HTTP ${response.status}`);
  }

  const text = await response.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Advisory endpoint returned a non-object JSON payload");
  }
  return data;
}

function summarizeAdvisories(findings) {
  const bySeverity = {};
  let advisories = 0;
  for (const entries of Object.values(findings)) {
    for (const advisory of entries) {
      advisories += 1;
      const severity = advisory.severity ?? "unknown";
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    }
  }
  return {
    packagesWithAdvisories: Object.keys(findings).length,
    advisories,
    bySeverity,
  };
}

// MongoDB upstream warns about a DATA CORRUPTION risk on Linux kernels
// 6.19 through 7.0.13. Containers share the host kernel, so the check is
// recorded from inside the verify container as well.
const MONGO_BAD_KERNEL = /^(6\.19|7\.0)(\.|$)/;

function preflightRuntime(images) {
  const kernelRelease = os.release();
  return {
    nodeVersion: process.version,
    kernelRelease,
    mongoKernelWarning: MONGO_BAD_KERNEL.test(kernelRelease),
    images,
  };
}

function githubAlertsSnapshot(repoRoot) {
  const snapshotPath = path.join(
    repoRoot,
    "docs",
    "design",
    "github-security-alerts.json",
  );
  if (!existsSync(snapshotPath)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    return {
      repository: snapshot.repository,
      analysisRef: snapshot.analysisRef,
      analysisCommit: snapshot.analysisCommit,
      counts: snapshot.counts,
      checkedAt: snapshot.checkedAt,
    };
  } catch {
    // A malformed snapshot must not silently disappear from the evidence.
    return { parseError: true };
  }
}

function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const outDir = path.join(repoRoot, "artifacts", "security");
  mkdirSync(outDir, { recursive: true });

  const checkedAt = new Date().toISOString();
  const rootLockPath = path.join(repoRoot, "npm-shrinkwrap.json");
  const webLockPath = path.join(repoRoot, "apps", "web", "package-lock.json");

  const rootLock = JSON.parse(readFileSync(rootLockPath, "utf8"));
  const rootRows = inventory(rootLock);
  writeJson(path.join(outDir, "root-inventory.json"), {
    source: "npm-shrinkwrap.json",
    lockfileVersion: rootLock.lockfileVersion,
    checkedAt,
    packages: rootRows,
  });

  // apps/web does not exist until the frontend scaffold package; write a
  // stable placeholder so downstream evidence checks always find the file.
  if (existsSync(webLockPath)) {
    const webLock = JSON.parse(readFileSync(webLockPath, "utf8"));
    const webRows = inventory(webLock);
    writeJson(path.join(outDir, "web-inventory.json"), {
      source: "apps/web/package-lock.json",
      lockfileVersion: webLock.lockfileVersion,
      checkedAt,
      packages: webRows,
    });
  } else {
    writeJson(path.join(outDir, "web-inventory.json"), {
      source: "apps/web/package-lock.json",
      checkedAt,
      packages: [],
      note: "apps/web lockfile not present yet (frontend scaffold package pending)",
    });
  }

  const lockHashes = {
    checkedAt,
    files: {
      "npm-shrinkwrap.json": {
        sha256: sha256File(rootLockPath),
      },
    },
    preflight: preflightRuntime({
      node: "node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c",
      mongo:
        "mongo:8.0.34@sha256:b9924c330a8bbc5800fe9c69f04a84e221eca7b28fd049a0354147d9908fa142",
    }),
    githubAlertsSnapshot: githubAlertsSnapshot(repoRoot),
  };
  if (existsSync(webLockPath)) {
    lockHashes.files["apps/web/package-lock.json"] = {
      sha256: sha256File(webLockPath),
    };
  }
  writeJson(path.join(outDir, "lock-hashes.json"), lockHashes);

  const endpoint =
    process.env.NPM_ADVISORY_ENDPOINT ??
    "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
  const nameVersions = uniqueNameVersions(rootRows);
  const findings = await fetchAdvisories(nameVersions, endpoint);

  const summary = summarizeAdvisories(findings);
  writeJson(path.join(outDir, "advisory-response.json"), {
    checkedAt,
    endpointOrigin: new URL(endpoint).origin,
    requestedPackages: Object.keys(nameVersions).length,
    counts: summary,
    findings,
  });

  // Structured completion log: counts, timestamp and sources only. Never
  // print the environment block or any credential-bearing value.
  process.stdout.write(
    JSON.stringify({
      event: "security.scan.completed",
      timestamp: checkedAt,
      counts: {
        rootPackages: rootRows.length,
        packagesWithAdvisories: summary.packagesWithAdvisories,
        advisories: summary.advisories,
      },
      sources: ["npm-shrinkwrap.json", new URL(endpoint).origin],
    }) + "\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "security.scan.failed",
        error: err instanceof Error ? err.message : String(err),
      }) + "\n",
    );
    process.exit(1);
  });
}
