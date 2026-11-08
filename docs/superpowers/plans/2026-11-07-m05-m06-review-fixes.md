# M05–M06 review fixes Implementation Plan

> Execution: inline in the current authorized review/fix session. Review agents
> inspect the Standards and Spec axes independently; code changes stay local.

**Goal:** Fix reproducible defects in the final M05–M06 implementation compared
with `origin/development` (`26d37f2`), preserving existing review work at
`1a65591`.

**Architecture:** Retain native authorization and executor boundaries. Publish
firmware by atomically replacing its public metadata pointer after immutable
content finishes uploading in a separate GridFS bucket; existing string file IDs
and legacy content remain readable. Correct UI adapters at their existing data
boundaries.

**Tech Stack:** Existing TypeScript, Node 24, MongoDB driver, React and Vitest.

## Global constraints

- Tests use Compose project `genieacs-pwa-check` and database
  `genieacs_plan_test` only.
- Preserve upstream history, license notices and existing local commits.
- Do not change milestone requirements, secrets or security exceptions.
- No automatic replay of device commands; retain current server authorization.

### Task 1: Lock down the newly reproduced defects

- [x] Add regression cases to `test/integration/files-replace.ts` for
      publication failure and overlapping uploads; assert old bytes remain
      downloadable on failure and completed content never mixes.
- [x] Add TR-181 and unresolved-identity cases in
      `packages/device-profiles/src/management-wan.test.ts`; assert critical
      writes/deletes/provisions throw `ManagementWanGuardError`.
- [x] Use real native object entries (without fabricated `value`) in
      `apps/web/src/features/config-ui/renderer.test.tsx`.
- [x] Add UI regressions for fault filters and repeated Summon requests; assert
      `device` is used for faults and each completed command gets a new ID.
- [x] Run the new cases before implementation and record the failures.

### Task 2: Publish complete firmware content atomically

- [x] Create `lib/file-storage.ts` for immutable content uploads, public
      metadata publication, legacy-compatible downloads and deletion. Add the
      content bucket to `lib/db/db.ts` and optional `contentId` to
      `lib/db/types.ts`.
- [x] Delegate the existing UI file helpers in `lib/ui/db.ts` to that module;
      keep its byte cap and range semantics. Route `lib/fs.ts` and NBI file
      writes/deletion through the same storage boundary.
- [x] Never delete current content before public metadata replacement succeeds.
      Keep a completed upload on an uncertain database publication outcome.
- [x] Verify the existing string ID, metadata, abort, byte-limit, range and
      successful-replacement tests plus the new fault/concurrency cases.

### Task 3: Correct management guard and native UI adapters

- [x] Guard TR-181 IP/PPP interface paths and lower-layer links; share both
      ConnectionRequestURL paths with server DNS resolution. Fail closed when
      the management identity cannot be determined.
- [x] Evaluate the parameter-table collection path operand and per-instance
      filter using native expression semantics.
- [x] Filter fault rows by their native `device` field. Clear a completed Summon
      operation ID while retaining it when the transport result is uncertain.
- [x] Re-run focused backend and React regression tests.

### Task 4: Verify and report

- [x] Run formatting, ESLint and TypeScript for backend/frontend, backend unit
      tests, affected package suites, web unit tests and production builds.
- [x] Rebuild the isolated engine-backed stack and run the M05–M06 browser
      suites; record failures and limits truthfully.
- [x] Save review findings and verification evidence; update ARD-221, ARD-223
      and their milestone parents in Linear without declaring unmerged work
      Done.

Final local evidence (8 November 2026): backend 114/114, profiles 52/52,
frontend 101/101, browser 129/129; lint/types/format and production builds pass.
Detailed findings: `docs/testing/m05-m06-review-2026-11-07.md`.

### Follow-up review: 8 November 2026

- [x] Reproduce the remaining queued-task false success with a real Mongo task.
      Probe task existence before marking it done; retain pending/unknown and
      remove queued work without replay when the session ends early.
- [x] Reproduce programmatic CodeMirror edits and hidden draft loss. Ignore
      `setValue` change events and preserve dirty source across a freshly
      authorized reveal. Verify real CodeMirror sync and hide/reveal round
      trips.
- [x] Reproduce native container filters and evaluate them before rendering.
- [ ] Repeat the required checks, update PR #8, wait for exact-head CI, merge
      into development and delete the merged feature branch.
