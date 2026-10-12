# AGENTS.md

This repository's agent guidance is maintained in **one** place — read it
regardless of which agent or tool you are:

- **[CLAUDE.md](CLAUDE.md)** — the index: architecture, rules, skills, quick
  commands, and version control.
- **[.claude/rules/](.claude/rules/)** — numbered rules applied in order; see
  [CLAUDE.md](CLAUDE.md)'s Rules index for the current, authoritative list
  (as of this writing: dev environment, error handling, unit testing,
  Playwright, Rust style, SQL migrations, hydration parity, offline writes,
  content validators, keep-skills-fresh, end-of-session).
- **[.claude/skills/](.claude/skills/)** — task recipes: `add-backend-route`,
  `add-playwright-flow`, `create-github-issue`, `ui-validate`.
- **[docs/architecture.md](docs/architecture.md)** — how the seven crates fit
  together (request flows, cross-module design); per-module detail lives in
  each file's own `//!` doc, printed by `just modules <dir>`.

This file is intentionally a thin pointer. **Do not duplicate content here** — a
drifting copy is worse than a redirect. Make changes in `CLAUDE.md` / `.claude/`.
