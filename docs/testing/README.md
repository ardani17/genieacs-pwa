# Testing harness (genieacs-pwa-check)

This repository verifies every package inside a throwaway Compose project
`genieacs-pwa-check`. Nothing here touches the reference deployment, its
volumes, or production databases.

## Layout

- `compose.dev.yaml` — interactive tooling container for builds and local
  commands (project `genieacs-pwa-dev`).
- `compose.test.yaml` — verification stack (project `genieacs-pwa-check`):
  - `mongo` — pinned `mongo:8.0.34` fixture instance with dummy credentials,
    health-checked via `mongosh ping`, **no published ports**.
  - `verify` — the pinned Node 24.22.2 tooling image with the repository bound
    at `/workspace`, project-scoped `node_modules` and npm cache volumes, and
    `MONGO_URL` pointing at database `genieacs_plan_test`.
- `scripts/check.mjs` — suite runner (`node scripts/check.mjs <id>|all`). Spawns
  each registered command as argv (no shell), refuses cwds outside the
  repository, fails fast on the first nonzero child, and validates that required
  artifacts exist and are non-empty (`UNKNOWN_SUITE` / `MISSING_EVIDENCE`
  otherwise). It also guards `MONGO_URL`: any database other than
  `genieacs_plan_test` aborts the run before a command executes.
- `scripts/check-suites.json` — the registry mapping package id to
  `[{cwd, command, args, artifacts?}]` steps. Every package MUST register its
  tests here; an unregistered suite cannot pass CI.
- `scripts/security/inventory.mjs` — dependency inventory + npm bulk advisory
  scan producing `artifacts/security/{root,web}-inventory.json`,
  `advisory-response.json`, `lock-hashes.json`. Transport/JSON failures are scan
  failures (nonzero exit); HTTP 404 from the advisory endpoint means "no
  advisories for this set" and is recorded as zero findings.
- `scripts/test-ts.mjs` — bundles root TS tests with esbuild (node platform,
  node24 target, external packages, CJS) into `artifacts/tests` and runs
  `node --test` on the results.

## Running

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml build verify
docker compose -p genieacs-pwa-check -f compose.test.yaml up -d mongo
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs all
docker compose -p genieacs-pwa-check -f compose.test.yaml down
```

Before `compose.test.yaml` provides a service (early packages), the same
commands run through the dev tooling container:

```sh
docker compose -f compose.dev.yaml run --rm tooling node --test scripts/security/inventory.test.mjs
```

## Evidence rules

- Artifacts live under `artifacts/` and are git-ignored; acceptance metadata
  (path, hash, test ids) is recorded in `docs/testing` notes per package, never
  the raw artifact.
- A missing or empty required artifact is a failure (`MISSING_EVIDENCE`), not a
  pass with zero output.
- The advisory scan logs one JSON line (`security.scan.completed`) with counts,
  timestamp and sources. It never prints the environment block, credentials or
  full request bodies.
- `artifacts/` content is synthetic data only.

## Registering a suite

Append to `scripts/check-suites.json`:

```json
"M01-Z": [
  {
    "cwd": ".",
    "command": "node",
    "args": ["scripts/test-ts.mjs", "test/example.ts"],
    "artifacts": ["artifacts/tests/test/example.test.cjs"]
  }
]
```

The package's write set must include `scripts/check-suites.json`; suites without
tests are rejected at review.
