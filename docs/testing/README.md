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
- `compose.e2e.yaml` — overlay adding the ENGINE `ui` service plus the fixture
  seeder (`scripts/fixtures/e2e-seed.mjs`: identities with native pbkdf2 hashes,
  permission docs, TEST- devices with a secret parameter) and pointing `web` at
  the engine. The base stack ships WITHOUT the engine on purpose (backend-down
  acceptance); browser tests require this overlay:

  ```sh
  docker compose -p genieacs-pwa-check -f compose.test.yaml -f compose.e2e.yaml up \
    --build --abort-on-container-exit --exit-code-from browser-tests \
    mongo victorialogs vector ui seed web browser-tests
  ```

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
docker compose -p genieacs-pwa-check -f compose.test.yaml up -d mongo victorialogs vector web
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs all
docker compose -p genieacs-pwa-check -f compose.test.yaml down
```

CI runs the same registry as the required `packages` job (plus an `e2e` job with
the overlay above), so an unregistered or failing suite blocks the pull request
— there is no missing-evidence exit 0.

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

## GitHub security acceptance (M01-S9)

The offline suite tests the evaluator and collector with dummy API pages. It
does not assert that GitHub alerts are fixed. Run it without network using the
existing bounded sandbox image:

```sh
docker compose -f compose.security-test.yaml run --rm --no-deps security-verify \
  timeout 35s env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/scratch/home \
  TMPDIR=/scratch/tmp NODE_ENV=test CI=1 \
  node /source/scripts/security/check-alerts.mjs M01-S9
```

After an authorized publication, `security-alerts.yml` runs CodeQL independently
for JavaScript/TypeScript and Actions, with security-extended queries and
distinct categories. The gate reads real analyses and repository/ref-scoped
alerts plus Dependabot metadata with full pagination
(`gh api --paginate --slurp`). Its token has `contents: read`,
`security-events: read` and `vulnerability-alerts: read`; no token is exposed on
fork PRs or written to the report.

Repository default CodeQL setup was still enabled at verification on 4
November 2026. Before accepting the advanced workflow, an authorized
administrator must transition default setup to advanced setup. Do not claim an
advanced scan passed while default setup is still preventing its upload. This
local change does not modify repository settings or publish a branch. See
GitHub's
[advanced setup transition](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning).

To collect acceptance evidence from the exact checked-out, published revision:

```sh
EXPECTED_REF=refs/heads/development EXPECTED_SHA="$(git rev-parse HEAD)" \
  GITHUB_REPOSITORY=ardani17/genieacs-pwa \
  node scripts/security/github-security-check-cli.mjs
```

Use the authenticated GitHub CLI (or the workflow's ephemeral token). The
command performs metadata reads only and writes
`artifacts/security/github-alert-report.json`. The workflow retains this report
for 14 days, including a blocked verdict when collection fails. A checkout
mismatch, missing category, stale/failed analysis, incomplete API response,
unmapped alert or unapproved risk fails the gate.

On pull requests (`EXPECTED_REF=refs/pull/N/merge`) the gate also evaluates
PR-only alerts: GitHub keeps analyses uploaded on a PR merge ref out of the
repository-wide alert list, so the collector reads them from the PR-ref snapshot
and judges them like any other alert — fixed-verified on the exact merge SHA, or
covered by a reviewed exception. Snapshot completeness (alerts 1–16 and
dependabot1) is still checked against the repository-wide list, and on branch
refs a ref alert missing from that list remains an API error. Triaged PR alerts
are marked `pr: true` in the gate's mapping; every new pull request re-triages
its own alert numbers against the same standard.

Known alerts may remain open on main before release. A clean scan on development
can prove absence on that ref; a patched esbuild graph is bound to the
checked-out SHA and all matching lock entries. The report retains
`githubState: open` for an esbuild fix on development and does not close or
dismiss the main alert.

Exceptions in `github-security-evidence.json` are pending proposals. If still
needed after scanning, a human reviewer must provide `approvedBy`, `reviewedAt`,
`reason`, `scope`, `cwe`, `compensation`, `owner` and `expiresAt` (within 30
days of review). Placeholder reviewers, invalid dates and automatic dismissals
do not constitute approval. M01 remains In Review until actual evidence and the
required dispositions pass; local unit-test success alone is insufficient.

References:
[Code scanning REST](https://docs.github.com/en/rest/code-scanning/code-scanning),
[Dependabot REST](https://docs.github.com/en/rest/dependabot/alerts),
[workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

## Registering another suite

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
