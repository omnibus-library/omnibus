# 04e — Playwright: the stats page

Companion to [04a-playwright-surfaces.md](04a-playwright-surfaces.md): the
`/stats` selectors that look right and match nothing, and the states a spec
must tell apart. `ui_tests/playwright/tests/flows/stats.spec.ts` and
`stats_household.spec.ts` are the worked specs.

**The stats period pills are not a menu, and half the page is not behind
them.** `/stats` splits on the windowed / standing boundary: the Week / Month /
Year / Lifetime pills (`stats-range-week` … `stats-range-all_time`) live in the
"In this window" band's own sticky header and govern that band alone. There is
no `role="dialog"` period menu and no `stats-range-trigger` — a spec that opens
one is asserting a control that no longer exists. Three consequences:

- **The hero and the standing band must not move on a switch.** The streak,
  both goals, the heatmap, the open-books list and the trailing-12 chart are
  standing figures; `stats.spec.ts` pins that with a before/after `textContent`
  comparison, and that test is the redesign's load-bearing assertion.
- **The library figures are behind a scope tab**, not below the fold —
  `stats-scope-tab-library` has to be clicked before `stats-library-size` or
  `stats-library-composition` exist in the DOM at all.
- **Lifetime drops every tile comparison.** `PeriodComparison` is `Default` for
  `AllTime`, so a delta drawn against it would report a reader's whole history
  as new; `stats-tile-*-delta` is absent there by design, not missing.
- **Goals edit in place, through the Settings editor.** `stats-goals-edit`
  swaps in `stats-goals-editor` — the same `ReadingGoalsCard` as
  `/settings?section=goals` — and a save refetches the all-time figures. The
  specs that reset the three per-user goal rows are serial for that reason.
- **An unset goal is not an empty state.** With no target the surface drops the
  ring and the bar but still reports the real figure — `stats-goal-today`,
  `stats-daily-{kind}-today` — so a spec asserting "no goal" must look for
  those, not for an invite. `*-invite` now renders only when the server sent no
  figure at all.
- **The household reader picker's options are in the DOM even while the menu
  is closed** — only `hidden` keeps them offscreen — so a spec asserting one
  is gone (sharing turned off) needs `toHaveCount(0)`, not a visibility check.
  Options are `stats-reader-option-you` / `stats-reader-option-<id>`, and
  `/api/rpc/stats` bodies carry `user_id` (`null` on the caller's own page).
  Only the caller's own page draws `stats-share-toggle` (household sharing).
