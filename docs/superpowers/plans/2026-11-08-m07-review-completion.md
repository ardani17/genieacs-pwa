# M07 Review and Completion Implementation Plan

**Goal:** Review and repair M07-A, complete the missing M07-B/C requested by the
user, verify and merge into development through a pull request.

**Architecture:** Keep settings and native authorization in acs-ui. Use an
internal token-authenticated VPN controller with a pure state machine and fixed
process arguments. The existing BFF forwards browser sessions only. The accepted
design is docs/design/contracts.md and ADR 0009; this task implements that
design without changing engine service boundaries.

**Tech Stack:** Existing pinned Node, TypeScript, Next/React, Mongo,
xl2tpd/pppd/iproute2, Vector and VictoriaLogs. No new npm dependencies.

## Constraints

- Test only with project genieacs-pwa-check and database genieacs_plan_test.
- Never commit credentials or environment files. Never log profile secrets.
- Persist before apply; retain the new desired profile when apply fails.
- Retry transient failures with 10/20/40/60 seconds and 0–20% jitter.
- Authentication rejection pauses retry until a revised profile or reconnect.
- Never install default routes, overlap Docker/ingress, or flush routing tables.
- Dashboard liveness is independent of VPN and log storage.

## Tasks

- [ ] Repair M07-A DTO/password handling, authenticated ciphertext checks,
      bootstrap access, stable identity, native validator calls, Mongo pool and
      secret-file provisioning. Add regression coverage in test/app-settings.ts,
      test/settings-permissions.ts and docker/bootstrap-secrets.test.mjs. Run
      `node scripts/check.mjs M07-A` in the check container.
- [ ] Implement M07-B under services/vpn-controller with state.ts, profile.ts,
      routes.ts, ppp-events.ts and server.ts. Runtime effects use fixed argv,
      protected atomic config files and generation-scoped PPP events. Add state,
      routing, process/config and HTTP tests; wire the Docker image, native
      controller bridge and dedicated test fixtures. Register M07-B.
- [ ] Implement M07-C VPN profile/status and log search pages, same-origin
      reconnect/diagnose/reset BFF routes, permission-aware navigation, CAS form
      preservation and bounded log search/export. Add React and browser tests
      through native fixture identities. Register M07-C.
- [ ] Review both standards and spec again. Run formatting, ESLint, TypeScript,
      backend/frontend unit tests, package suites, production builds and browser
      tests. Attempt the supplied L2TP test endpoint only in the isolated lab
      and record actual kernel/network results.
- [ ] Commit conventional changes, prepare a PR to development, wait for CI and
      merge after required checks pass. Record verification and any lab limit.
