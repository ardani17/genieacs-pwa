# M01 security evidence gate implementation plan

> Execute inline, in dependency order, on `fix/m01-security-gate`.

**Goal:** Make ARD-206 consume verifiable GitHub evidence and keep M01 open
until the acceptance gate passes on the published source revision.

**Architecture:** Keep the offline evaluator independent of transport. A
collector reads all GitHub API pages, scopes CodeQL evidence to an exact
ref/SHA/category, and checks the checked-out dependency graph. The workflow runs
both CodeQL languages and invokes the collector. No synthetic analysis or
automatic dismissal.

**Tech stack:** Node.js built-ins, GitHub CLI/REST API, existing Docker sandbox.

## Constraints

- Preserve local development history and upstream notices; target development.
- No push, workflow dispatch, alert dismissal, or risk approval in this local
  run.
- API/JSON/pagination/missing/stale evidence fails closed.
- Require JavaScript/TypeScript and Actions analyses for the same ref and SHA.
- Risk exceptions require a named reviewer, review timestamp, CWE, compensation,
  scope and expiry within 30 days; placeholder approvals do not count.
- Keep main alert state separate from a verified development dependency fix.
- Execute regression tests without network in the bounded read-only sandbox.

## Task 1: Offline evaluator regression and fix

Files: `scripts/security/github-alert-gate.mjs` and its `.test.mjs`.

- [x] Add regressions asserting `passed === false` for split SHA/ref evidence,
      missing category, failed analysis, undocumented dismissals, unknown alerts
      with exceptions, invalid expiry and incomplete review metadata.
- [x] Run `node --test scripts/security/github-alert-gate.test.mjs` in the
      existing security container with an empty allowlisted environment; observe
      failures.
- [x] Validate analyses and exceptions without accepting unrelated evidence.
- [x] Re-run regressions plus existing positive/parity fixtures.

## Task 2: Collector and workflow

Files: new `scripts/security/github-security-check.mjs` and `.test.mjs`,
`.github/workflows/security-alerts.yml`, `scripts/check-suites.json`,
`scripts/security/check-alerts.mjs`.

- [x] Expose `readGithubPages`, `collectGithubEvidence` and an executable CLI.
      Transport accepts GitHub CLI slurped page arrays; reject malformed or
      failed pages. Unit tests inject dummy API results and never contact
      GitHub.
- [x] Read real analyses, repository/ref alert lists and Dependabot alerts.
      Require all historical mappings to remain accounted for and new alerts to
      block. Match alert instances to the target ref/SHA.
- [x] Bind local esbuild resolution to the checked-out SHA and all matching lock
      entries; do not mark the main Dependabot alert closed from a local fix.
- [x] Run matrix CodeQL categories and invoke the collector with read
      permissions for security events and vulnerability alerts. Keep fork
      secrets unavailable.
- [x] Register collector tests in the existing M01-S9 suite and bounded runner.

## Task 3: Evidence, validation and handoff

Files: `docs/testing/github-security-evidence.json`, `docs/testing/README.md`.

- [x] Explain exact-ref commands, report output and pending human exception
      review.
- [x] Run focused sandbox tests, format/lint/type checks, backend tests/build
      and verify artifacts using existing local dependencies and resource
      limits.
- [x] Check final diff and prepare Conventional Commit(s).
- [x] Update ARD-206 with exact results and remaining publication/approval
      steps. Mark M01 Done only after real exact-ref evidence and approved
      dispositions.

## Evidence sources

- https://docs.github.com/en/rest/code-scanning/code-scanning
- https://docs.github.com/en/rest/dependabot/alerts
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

These APIs distinguish ref-scoped instances from repository-wide alert state;
`vulnerability-alerts: read` grants the Dependabot metadata read used by the
gate.

## Local verification result

- Focused M01-S9: 25/25 PASS after red/green regressions.
- Full-repo Prettier, root ESLint, JavaScript lint, TypeScript and YAML parse
  PASS.
- Backend tests: 70/70 PASS, 0 skip, against a temporary network-less Mongo
  namespace; production build and four executables/public assets PASS.
- An earlier backend run without Mongo timed out and was discarded. The complete
  rerun above used the required fixture and passed. Disposable Mongo was
  removed.
- Next acceptance stage: publish the cumulative reviewed M01–M04 source and this
  repair via PR; transition default CodeQL to the advanced matrix, then evaluate
  real exact-ref evidence. Human risk approvals remain pending where applicable.
