# Hearth

Self-hosted household finance: personal finance, group expense splitting and allocated budgets in one app.

- Design spec: `docs/superpowers/specs/2026-10-11-hearth-design.md`
- Backlog: `docs/backlog/README.md` · Board: https://github.com/users/Facabore/projects/4
- Stack versions: `docs/stack-versions.md`

## Development

Everything runs in Docker (see "Containerized development" below once available). With a host Node.js 24:

    corepack enable
    pnpm install --frozen-lockfile
    pnpm test
