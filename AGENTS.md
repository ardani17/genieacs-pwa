# GenieACS PWA

This fork uses GenieACS v1.2.16 as its initial backend baseline. The custom
Next.js/PWA frontend is planned; the current `ui/` directory is the upstream
Mithril UI.

## Branch workflow

- `main` contains release history. Release pull requests come from
  `development`.
- `development` integrates reviewed changes.
- Start each change from updated `development` on `feature/<name>`,
  `fix/<name>`, or `chore/<name>`. Target pull requests at `development`.
- Use `origin` for this fork. `upstream` is the official GenieACS source.
- Preserve upstream history and license notices.

Read `docs/DEVELOPMENT.md` when setting up a checkout, choosing a branch,
running checks, updating upstream code, or preparing a release. Its fork
workflow takes precedence over upstream contribution instructions.

## Scope and verification

- Keep backend changes focused and preserve upstream service boundaries.
- Introduce the Next.js application separately from the existing `ui/` when its
  design is approved. Keep NBI access on the server side.
- Keep credentials, device exports, production database dumps, and `.env` files
  outside Git.
- Run formatting checks, ESLint, TypeScript, unit tests, and a production build
  before pushing a change. The Docker commands are in `docs/DEVELOPMENT.md`.
- Use Conventional Commits and include verification results in pull requests.
