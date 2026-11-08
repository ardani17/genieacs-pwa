# shadcn/ui adoption completion plan

**Goal:** Finish the shadcn/ui adoption in `apps/web` so every interactive
element in feature views uses the shared primitives, closing the gaps found by
the 8 November 2026 audit and the component list in the design contract.

**Architecture:** The existing Next.js App Router app, native-auth BFF and
source-owned shadcn/ui layer stay in place. This effort only adds the missing
primitives to `apps/web/src/components/ui` and migrates the remaining raw
elements in feature views. No engine, NBI or permission change is involved.

**Tech stack:** Existing Next.js/React/TypeScript, Tailwind CSS 4, the unified
`radix-ui` package, Lucide, `cn()` from `src/lib/utils`; existing Vitest and
Playwright. No new npm dependencies.

## Linear tracking

- Parent: ARD-240 (related to M03/ARD-157).
- Package A primitives: ARD-241.
- Package B form controls: ARD-242 (blocked by ARD-241).
- Package C tables: ARD-243 (independent).
- Package D AlertDialog/DropdownMenu: ARD-244 (blocked by ARD-241).
- Package E wrap-up: ARD-245 (blocked by ARD-242/243/244).

## Audit findings (precise locations)

- `apps/web/src/components/ui` lacks `AlertDialog` and `DropdownMenu` required
  by `docs/design/ui-design-system.md`; `Checkbox` and `Textarea` do not exist
  although consumers need them.
- `apps/web/src/features/devices/device-list.tsx:99` raw `<input>` (bulk tag)
  and `:296` raw checkbox.
- `apps/web/src/features/logs/log-search.tsx:160` raw `<select>`.
- `apps/web/src/features/vpn/profile-form.tsx:221,304,342` three raw `<select>`
  elements and `:269` a raw `<textarea>`.
- `apps/web/src/features/admin/files.tsx:186` improvised file input (hand styled
  label acting as a button).
- `apps/web/src/features/config-ui/components.tsx:163,243` and
  `apps/web/src/features/admin/permissions.tsx:171` hand-rolled tables that
  bypass `table.tsx`.
- `apps/web/src/features/overview/overview.tsx:260` keeps its `<table>` on
  purpose as a screen-reader alternative; it is out of scope.

## Global constraints

- Authoritative design: `docs/design/ui-design-system.md` (revision 4 November
  2026). Touch targets at least 44 px, viewports 360×800, 768×1024, 1440×900.
- No new npm dependencies: `radix-ui` 1.8.1 already exports the AlertDialog and
  DropdownMenu namespaces, so `apps/web/package-lock.json` must not change.
- Feature behavior, permissions and endpoints stay identical; if an e2e spec
  pins old markup, prefer keeping behavior in the component over loosening the
  test.
- Primitives follow the existing convention (see `select.tsx`): the header
  comment `Adapted from shadcn/ui (MIT), new-york-v4 registry, 2026-11-08` with
  the registry URL, `"use client"`, `cn()` from `@/lib/utils` and semantic
  Tailwind tokens.
- Out of scope: retiring the upstream Mithril UI in `ui/`, M07-D/ARD-190, M08
  PWA, M09, the M01/ARD-206 security gate, and any form/query library.

## Task 1: Planning record (this document)

Files: this plan.

- [x] Create ARD-240…ARD-245 in Linear with blocking relations before any UI
      source changes.
- [ ] Commit this plan to development through `chore/shadcn-adoption-plan`
      (branch policy allows feature/\*, fix/\*, chore/\* only).

## Task 2: Package A — primitives (ARD-241)

Files: create `apps/web/src/components/ui/checkbox.tsx`, `textarea.tsx`,
`alert-dialog.tsx` and `dropdown-menu.tsx`; extend
`apps/web/src/components/ui/ui.test.tsx`.

- [ ] Add `checkbox.tsx` (Radix Checkbox, CheckIcon indicator, 44 px target),
      `textarea.tsx` (same styling family as `input.tsx`, `min-h-11`),
      `alert-dialog.tsx` (same styling family as `dialog.tsx`) and
      `dropdown-menu.tsx` (items `min-h-11`).
- [ ] Add unit tests: render, basic interaction (toggle, open/cancel/confirm,
      menu item selection) and ARIA roles.
- [ ] Verify the four checks below plus the standalone artifact; confirm the
      lockfile diff is empty.

## Task 3: Package B — form controls (ARD-242)

Files: `apps/web/src/features/devices/device-list.tsx`,
`apps/web/src/features/logs/log-search.tsx`,
`apps/web/src/features/vpn/profile-form.tsx`,
`apps/web/src/features/admin/files.tsx`.

- [ ] Replace the raw bulk-tag input and raw checkboxes in `device-list.tsx`
      with `Input` and `Checkbox` (linked labels, indeterminate preserved).
- [ ] Replace the raw `<select>` in `log-search.tsx` and the three in
      `profile-form.tsx` with the `Select` primitives (controlled value via
      `value`/`onValueChange`); replace the raw `<textarea>` with `Textarea`.
- [ ] Replace the improvised file input in `files.tsx` with the shadcn pattern:
      a `sr-only` `<input type="file">` wrapped by a `Button` label.
- [ ] Run the checks plus the `device-list`, `vpn-logs` and `admin-users-files`
      e2e specs; spot-check the three viewports and keyboard/focus behavior on
      migrated controls.

## Task 4: Package C — tables (ARD-243)

Files: `apps/web/src/features/config-ui/components.tsx`,
`apps/web/src/features/admin/permissions.tsx`.

- [ ] Rebuild the parameter/instance tables and the permission list with
      `Table/TableHeader/TableRow/TableHead/TableBody/TableCell`, keeping the
      labeled scroll areas, density and existing loading/empty/error states.
- [ ] Row rendering logic stays unchanged; only markup/structure moves.
- [ ] Run the checks plus the `admin-config` e2e spec; spot-check the three
      viewports.

## Task 5: Package D — AlertDialog and DropdownMenu in real use (ARD-244)

Files: admin views (`users`, `presets`, `provisions`, `files`, `permissions`)
and device action components, decided by the audit.

- [ ] Audit destructive confirmations; migrate delete/reset confirmations that
      use plain `Dialog` or improvised patterns to `AlertDialog` (focus on the
      cancel/destructive action, busy/disabled prevents double submits).
- [ ] Apply `DropdownMenu` only where row actions genuinely overflow (mobile
      stacking or crowded desktop rows); if no site truly needs it, record the
      audit result instead of forcing a change.
- [ ] Business flows, permissions and endpoints stay unchanged.
- [ ] Run the checks plus the admin and `device-commands` e2e specs; record the
      audit (migrated/skipped sites with reasons) in the PR and on ARD-244.

## Task 6: Package E — wrap-up (ARD-245)

Files: `docs/design/ui-design-system.md`, `docs/DEVELOPMENT.md`,
`scripts/check-suites.json`, `docs/testing/`.

- [ ] Add the revision note to `ui-design-system.md` (complete primitive set,
      raw elements migrated) and fix the stale Mithril sentence in
      `docs/DEVELOPMENT.md`.
- [ ] Register per-package suites in `scripts/check-suites.json` following the
      existing M07 entries and write the testing evidence note.
- [ ] Record PR/evidence links on ARD-241…ARD-244, move them to Done and close
      ARD-240.

## Verification commands

```sh
npm run lint --prefix apps/web
npm run typecheck --prefix apps/web
npm run test --prefix apps/web
npm run build --prefix apps/web
test -s apps/web/.next/standalone/apps/web/server.js
git diff --stat -- apps/web/package-lock.json
npx prettier --check --prose-wrap always .   # docs changes
```

Each package lands on `feature/<name>` from an updated `development` and is
published as a PR to `development` with Conventional Commits and verification
results in the PR body.

## Completion

- Interactive elements in the audited files all use `@/components/ui`
  primitives; the sr-only overview table stays as is.
- Lockfile untouched; all checks, builds and e2e specs pass; visual acceptance
  recorded for the three viewports.
- Linear statuses reflect reality; this plan's checkboxes are ticked as packages
  merge.
