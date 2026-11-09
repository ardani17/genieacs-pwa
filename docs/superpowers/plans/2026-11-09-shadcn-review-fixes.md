# shadcn review fixes implementation plan

> **For agentic workers:** Execute inline in this session. Review and fixes are
> authorized by the user's request; the existing adoption plan defines behavior.

**Goal:** Restore asynchronous deletion confirmations and prevent duplicate file
deletions found while reviewing `e858410...c9b7c64`.

**Architecture:** Keep controlled AlertDialog consumers open until the existing
DELETE request succeeds. Retain the target and show failure feedback inside the
modal; block dismissal and repeated submission while pending. Add file-specific
deletion state without changing endpoints or permissions.

**Tech Stack:** Existing React, Radix, TypeScript, Vitest and Playwright.

## Global constraints

- Preserve the adoption plan's behavior, endpoints, permissions and
  dependencies.
- Use `fix/shadcn-review`, target `development`, preserve upstream history.
- Keep VPN credentials and device evidence in ignored local files.

## Task 1: Restore pending deletion lifecycle

**Files:**

- Test: `apps/web/src/features/admin/delete-confirmation.test.tsx`.
- Modify:
  `apps/web/src/features/admin/{resource-editor,users,files,permissions}.tsx`.
- Modify: `apps/web/src/components/ui/alert-dialog.tsx` and `ui.test.tsx` to
  remember and restore the opener for controlled dialogs without a Trigger.

**Interfaces:** Existing controlled `AlertDialog`, `remove`/`removeUser`
handlers, and typed API envelopes; no new public interface.

- [x] Run the new real-consumer regression tests before the fix:
      `npm run test --prefix apps/web -- src/features/admin/delete-confirmation.test.tsx`.
      Expect failure: the pending dialog is absent.
- [x] Prevent the Action's default closure, guard `onOpenChange` while busy,
      disable confirmation/cancel while pending, and close only on success. For
      files, set deletion state in `try/finally` and catch network failure.
- [x] Render failed deletion status inside the dialog. Test a deferred403,
      blocked Escape/double click, a successful retry to the same target, and
      file network failure followed by cancellation.
- [x] Reproduce focus loss on Escape before fixing it, then test opener focus
      restoration for both state-driven dialogs and standard Trigger usage.
- [x] Re-run the regression command and the full frontend suite.
- [x] Run formatting, frontend/backend lint and type checks, unit tests, builds
      and artifact checks; run affected real-stack browser specs.
- [ ] Commit with `fix(ui): preserve pending deletion confirmations`; create a
      PR with before/after evidence, wait for required CI, merge to development.

## Task 2: Live VPN verification after merge

- [ ] Reuse the isolated lab overlay and ignored profile, verify server and
      credentials against the user's supplied endpoint without printing secrets.
- [ ] Establish PPP, check the assigned address, peer, routes and bounded
      connectivity probes. Inspect available ACS device records without changing
      modem settings; distinguish VPN peers from devices reporting to this ACS.
- [ ] Record redacted evidence locally and report the observed result and any
      missing network information needed to reach the modem.
