# shadcn/ui refactor implementation plan

**Goal:** Give M03–M04 one consistent shadcn/ui design system and demonstrate it
in the running local preview.

**Architecture:** Next.js App Router and the native-auth BFF stay in place.
Source-owned shadcn/ui primitives, Radix interactions, Tailwind CSS 4 and
semantic CSS variables form the shared UI layer. Domain views compose that layer
and keep the existing fetch, permission, masking, URL state and error contracts.

**Tech stack:** Existing Next.js/React/TypeScript, Tailwind CSS 4, shadcn/ui
source, Radix, Lucide, clsx, tailwind-merge, class-variance-authority; existing
Vitest and Playwright.

## Global constraints

- Authoritative design: `docs/design/ui-design-system.md` and Linear ARD-218.
- Background #F5F9FF, surface #FFFFFF, primary #1D4ED8, hover #1E40AF, text
  #0F172A, muted #475569, border #CBD5E1, success #166534, warning #92400E,
  destructive #B91C1C.
- System font, spacing 4/8/12/16/24/32 px, radius 12 px, touch targets at least
  44 px. Viewports: 360×800, 768×1024, 1440×900.
- Keep BFF/native session and Authorizer behavior, server masking and CSV/query
  parity. No device-write feature is added by this refactor.
- Dependency versions are resolved from the official registry, saved exactly in
  `apps/web/package.json` and locked. Keep the existing framework versions.
- Keep the user's development checkout as the integration/testing branch. Work
  commits are integrated there; main remains release history.
- M01/ARD-206 stays open until its independent security acceptance is complete.

## Task 1: Contract and planning (ARD-218)

Files: `docs/design/ui-design-system.md`, `docs/design/contracts.md`,
`docs/design/security-upgrade.md`, `docs/design/decision-register.md`, this
plan.

- [x] Save the full contract in Linear before changing UI source.
- [x] Create ARD-218/219/220 and reopen the M03/M04 parent scope.
- [x] Synchronize repository contract references and remove the conflicting
      CSS-Modules-only decision from the current contract.
- [x] Format/check the docs, commit them to development and attach the SHA to
      ARD-218. Mark planning Done before implementing ARD-219.

## Task 2: Shared foundation and M03 (ARD-219)

Files:

- Modify `apps/web/package.json`, `apps/web/package-lock.json`,
  `src/app/globals.css`, `src/app/layout.tsx`.
- Create `apps/web/components.json`, `apps/web/postcss.config.mjs`,
  `src/lib/utils.ts`.
- Create/update source-owned primitives in `src/components/ui` and compose
  shared application page-header, field and state patterns.
- Update `src/components/navigation.tsx`, connection/error components,
  `src/app/login/page.tsx`, `src/app/setup/page.tsx`,
  `src/app/account/password/page.tsx` and dashboard layout.

Interfaces:

- `cn(...inputs: ClassValue[]): string` joins clsx and tailwind-merge output.
- Button variants: default, secondary, destructive, outline, ghost, link. Busy
  buttons expose aria-busy and disable duplicate submission.
- Input/Label/Field compose stable IDs, descriptions and error state.
- Dialog/Sheet use controlled open state, Escape, focus trap and focus return.
- Navigation consumes the existing feature-availability and session permission
  data; its active link uses aria-current.

Steps:

- [ ] Resolve the official package versions and record the metadata. Install
      Tailwind 4/PostCSS, shadcn component dependencies and the Radix primitives
      actually used; save exact versions and the package lock.
- [ ] Configure PostCSS and Tailwind's CSS entry. Map semantic variables to the
      contract palette and keep all fonts/icons local.
- [ ] Add the official shadcn/ui component source and its attribution. Add cn
      with clsx/tailwind-merge and configure components.json paths.
- [ ] Replace shared primitives and migrate their consumers in one testable
      increment; avoid two competing button/form/dialog systems.
- [ ] Implement desktop sidebar and mobile topbar/bottom navigation + Sheet,
      preserving permission and available-route behavior.
- [ ] Apply shared form/card/alert patterns to login, setup and account and
      shared status/error patterns to the shell.
- [ ] Run component tests including keyboard/focus/Escape, busy, errors and
      navigation permissions. Run lint/typecheck/build, audit dependencies and
      inspect all three viewports before marking ARD-219 Done.

Commands (run in the frontend tooling container with the workspace mounted):

```sh
npm run lint --prefix apps/web
npm run typecheck --prefix apps/web
npm run test --prefix apps/web
npm run build --prefix apps/web
test -s apps/web/.next/standalone/apps/web/server.js
```

## Task 3: M04 domain views (ARD-220)

Files: `src/features/overview/overview.tsx`,
`src/features/devices/{device-list,filter-bar,device-detail,parameter-browser,diagnostics}.tsx`,
dashboard route pages, relevant component tests and e2e specs.

Interfaces and parity:

- Query parameters and BFF URLs remain the source of list/count/CSV state.
- DataView states stay explicit: loading, empty, error, permission-denied,
  unavailable and ready; raw empty arrays do not imply successful loading.
- Parameter values remain masked server-side; read-only diagnostics preserve
  authorized/missing/filtered behavior and unavailable evidence.

Steps:

- [ ] Convert overview to shared metric/section cards with labeled data and
      text/table alternatives, source and observation time.
- [ ] Convert filter toolbar, desktop table, mobile cards, pagination and CSV
      action to shared components while preserving URL/back navigation.
- [ ] Convert detail headings, status badges, tabs, parameter search and
      diagnosis state panels to the same component/spacing vocabulary.
- [ ] Remove unused old CSS Modules after the final consumer moves.
- [ ] Check representative synthetic preview data against the actual native
      fields so totals and filters agree.
- [ ] Run Vitest and engine-backed Playwright at all target sizes; verify
      search/tag/backslash, sorting, paging, CSV/masking and diagnosis parity.
- [ ] Build and refresh the localhost:3104 preview from development. Save
      screenshots and evidence in Linear before marking ARD-220 Done.

## Completion

- [ ] M03 and M04 acceptance include visual inspection as well as test results.
- [ ] Parent/milestone progress reflects the new scope and actual completion.
- [ ] Preview remains available for the user; no production database or device
      commands are used for visual verification.

Implementation is performed inline in task order. The active M01 source/CI
follow-up remains separately tracked on ARD-206 and must not be reported closed
from UI work.
