# shadcn/ui M03–M04 verification — 4 November 2026

The Linear contract was saved and read back before source changes, then
committed as `462fbe201b3f6ee3f276a7222823b6a54f16df14` (ARD-218).
Implementation follows `docs/design/ui-design-system.md` under ARD-219/220.

## Delivered behavior

- Official shadcn/ui new-york-v4 source, Radix interactions, semantic Tailwind 4
  tokens, local Lucide icons and the retained MIT notice.
- Shared forms, busy buttons, statuses, alerts, loading/empty/denied/unavailable
  states, desktop navigation, mobile Sheet and keyboard focus behavior.
- Overview cards and count-filter links; device filters, sorting, pagination,
  table/mobile cards and CSV; detail Tabs, parameter browser and diagnosis.
- BFF authentication, native permissions, query generation, server masking and
  service boundaries remain in place. Fixture `_deviceId` now matches native
  identity filters. Preview uses newly built web and engine images.

## Verification

| Check                            | Result                                  |
| -------------------------------- | --------------------------------------- |
| Frontend ESLint                  | exit 0                                  |
| Frontend TypeScript              | exit 0                                  |
| Vitest                           | 67/67 tests, 16 files, PASS             |
| Engine-backed Playwright         | 51/51, 0 skipped/flaky/unexpected, PASS |
| Browser viewports                | 360×800, 768×1024, 1440×900             |
| Production web image             | build and standalone runtime PASS       |
| Production engine image          | build PASS                              |
| Registry lockfile advisory check | 413 package names, no advisories        |

Browser assertions cover actual fixture login, unavailable navigation, control
height, overflow, Sheet Escape/focus return, native filter/count/list/CSV
parity, page-size and sort URL state, literal tag/backslash search and reload,
keyboard Tabs, secret masking, missing devices and explicit diagnosis.

The first browser run exposed mobile overview overflow and a stale engine image.
The final run uses the current engine build, fixes the constrained grid and
accessible text-table wrapper, and searches paginated parameter fixtures before
inspecting their masked row.

The official npm bulk advisory endpoint initially reported
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) for
transitive minimatch 10.2.6. The frontend overrides it to 11.0.1; its official
metadata supports CommonJS and Node 24, and lint/tests/build pass with that
version. The final bulk response has an empty advisory object. This is a
registry advisory check, separate from M01's GitHub CodeQL acceptance.

## Reviewable preview and evidence

- Local preview: <http://localhost:3104/overview>, 30 synthetic demo devices.
- Full browser report: `artifacts/ui-refactor/e2e-results.json`.
- Screenshots: `artifacts/ui-refactor/overview-desktop.png`,
  `overview-mobile.png`, `devices-tablet.png`; login/account images under
  `artifacts/playwright/ui-contract-forms-*`.
- Registry response: `artifacts/ui-refactor/audit-bulk.json`.
- Image tags: `genieacs-pwa-web:shadcn-preview` and
  `genieacs-pwa-engine:shadcn-preview`.

Artifacts contain fixture session state and are intentionally ignored by Git.
Screenshots of synthetic data are attached to ARD-219/220. Inform counts change
as the fixture timestamps age; F670 and total counts are both 30.

M01/ARD-206 remains open for its separate security/CI acceptance. M05 actions
and M08 PWA installation/offline behavior remain outside this UI refactor.
