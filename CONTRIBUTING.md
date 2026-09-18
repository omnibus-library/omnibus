# Contributing to Omnibus

Thanks for your interest in Omnibus. This guide explains how a change goes from
idea to merged pull request. It applies to everyone; trusted contributors with
push access get a shorter path, called out below.

## Before you start

- **Bugs and small fixes** are always welcome. Open an issue with a clear
  reproduction and it will usually be approved quickly.
- **Features and larger changes** need discussion first. Omnibus has a roadmap,
  and unplanned work is more likely to be declined than merged. Open an issue
  and wait for a maintainer to approve the direction before writing code.
- **Security issues** must not be filed as public issues. See
  [SECURITY.md](.github/SECURITY.md).

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). It applies in issues,
pull requests, and every other project space.

## Issue first, pull request second

> Every pull request must link to an approved issue that is assigned to you.
> Pull requests without a linked, approved issue will be closed without review.

1. **Find or open an issue.** Search first. If nothing matches, open one using
   the issue forms. Follow the house style: a bracketed `[Scope]` title prefix,
   a short description, an implementation sketch, the affected crates, and
   acceptance criteria.
2. **Get maintainer approval.** Approval means one of:
   - a maintainer comment explicitly approving the approach, or
   - a maintainer assigning the issue to you.

   A thumbs-up reaction or silence is not approval. If nobody responds within
   seven days, leave one polite follow-up and mention @seamus-sloan or
   @roberte777.
3. **Build it.** See the development section below.
4. **Open the pull request.** Link the issue with `Closes #<n>` in the body.

### Trusted contributors

Contributors with push access work on branches in this repository rather than a
fork, and may merge their own pull requests once every required check is green
and every review thread is resolved. The rest of this guide still applies:
issue first, fill in the template, keep commits conventional.

## Development

Setup, the dev stack, and per-crate commands are documented in
[docs/local-development.md](docs/local-development.md) and
[docs/architecture.md](docs/architecture.md). The short version:

```bash
just serve          # multiplexed dev stack
just check          # lint then test across the crate matrix
just lint-ts        # Playwright TypeScript: biome + tsc
just ios-test       # native iOS unit suite
just ios-test-ui    # native iOS UI suite
```

Run the full quality gate yourself before marking a pull request ready for
review. CI runs the same checks and all of them are required to merge:

| Required check | What it runs |
|---|---|
| Rustfmt | `cargo fmt --check` |
| Clippy | `cargo clippy -D warnings` across every crate and target |
| Cargo Test | the full test matrix (`just test`) |
| Cargo Audit | RustSec advisory scan of `Cargo.lock` |
| Stylelint | structural CSS lint |
| TS Lint | biome + `tsc --noEmit` for Playwright |
| Playwright | end-to-end browser tests |
| iOS Tests | the `omnibusTests` unit suite and the `omnibusUITests` UI suite |

Some checks path-filter themselves and report as skipped when the diff doesn't
touch what they cover. That counts as passing.

### Dependencies

Propose any new dependency in the linked issue before adding it. Every
workspace crate is MIT licensed and `cargo deny` enforces license compatibility
in CI, so a dependency with an incompatible license will fail the build.

## Branches, commits, and pull requests

- **Branch names** follow `OMNI-<issue>/<short-slug>`, for example
  `OMNI-2583/org-rename-refs`. Contributors working from a fork can use any
  branch name.
- **Commits and PR titles** use [Conventional Commits](https://www.conventionalcommits.org/)
  with the `feat:`, `fix:`, or `chore:` prefix and no scope. The PR title
  becomes the squash-merge commit subject, so keep it under about 70 characters.
- **Fill in the pull request template.** Every section, every time. The
  **Version** section decides whether the merge cuts a minor or patch release;
  pick one, or add the `no release` label.
- **Playwright runs itself when it matters.** The E2E workflow path-filters:
  it runs whenever the diff touches `frontend/`, `shared/`, `server/`, `db/`,
  `ui_tests/`, or the build inputs, and reports as skipped otherwise. There is
  no label to add. To force a run on a PR outside those paths, trigger the
  workflow manually from the Actions tab.
- **Open as a draft** if the implementation isn't finished. Ready-for-review
  means the quality gate passes locally.

### Review

Copilot reviews every pull request automatically. Address or answer each of its
comments and resolve the thread yourself. Merging requires every thread to be
resolved.

When a maintainer leaves comments:

- Push additional commits to address them. Do not force-push during review
  unless the reviewer asks you to.
- Let the reviewer resolve their own threads once they've confirmed the fix.

Pull requests are squash-merged by default. A maintainer merges outside
contributions after review; trusted contributors merge their own.

## License

Omnibus is [MIT licensed](LICENSE). By contributing you agree that your
contributions are licensed under the same terms.
