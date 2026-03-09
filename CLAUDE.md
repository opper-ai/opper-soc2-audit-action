# CLAUDE.md

## Commit conventions

This project uses **Conventional Commits** for automated versioning via release-please.

- `fix:` — patch release (1.0.x)
- `feat:` — minor release (1.x.0)
- `chore:`, `ci:`, `docs:`, `refactor:`, `test:` — no release

Always use a conventional commit prefix. Keep the subject concise (under 70 chars).

## Development

- Node >= 20, TypeScript
- `npm run typecheck` — type check
- `npm test` — run tests (node --test with tsx)
- Tests live alongside source files as `*.test.ts`
