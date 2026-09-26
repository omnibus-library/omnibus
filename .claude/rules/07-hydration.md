# 07 — SSR/WASM hydration parity

Omnibus is a Dioxus fullstack app: the server renders HTML (SSR), and the
WASM client re-renders the same component tree and **hydrates** it (adopts
the existing DOM, wiring up event handlers). Hydration assumes the first
client render produces markup identical to the SSR render. When it
doesn't, Dioxus mis-adopts nodes — you get a blank page, a flash of wrong
content, or controls whose handlers never fire.

## The invariant

**Never feature-gate a component *body* on `web` / `mobile` / `server`.**
A component must emit the same rsx on every target; gate only the
*interop* it runs after mount (the `use_effect` that calls
`dioxus::document::eval`, the `gloo_net` fetch). SSR and the first WASM
paint must match.

## Common causes

- **`#[cfg(feature = "web")]` around rsx** — the classic. SSR omits a
  subtree the client renders (or vice versa). Move the gate into the
  effect, not the markup.
- **State that differs SSR vs client at first paint** — e.g. a signal
  seeded from `localStorage` on web but from a default on SSR. Seed both
  to the same value and let an effect reconcile after mount.
- **Non-deterministic content in render** — timestamps, random ids, or
  `Date::now()` baked into markup differ between the two renders.
- **Hook-order divergence** — conditionally declaring hooks (or a
  different count) on one target. Declare every hook unconditionally, in
  the same order, on every target.
- **Swapping element *types* in a conditional** — `if x { img {…} } else {
  span {…} }` makes the diff replace the node rather than update it, and
  handlers registered on siblings rendered alongside it stop firing. The
  symptom is a button that clicks but does nothing, with no console error.
  Keep one stable outer element and swap its *children* instead —
  `components/user_avatar.rs` is the worked example (a journal card's
  Delete died the moment its author had a profile picture).
- **Duplicate keys among keyed siblings** — same symptom, different
  cause, and this one fires on the first *update* rather than at mount, so
  the page paints correctly and then dies on the first click. See below.

## Keyed siblings must each be unique

`dioxus-core` requires it. Two siblings sharing a key collapse in the
diff's key→index map: one old node is diffed against two new ones and
another is neither diffed nor removed, so the mounted-node table no
longer describes the DOM and event dispatch stops. A debug build asserts
(`keyed siblings must each have a unique key`) and the panic kills the
VirtualDom outright; a release build has `debug-assertions` off and
corrupts quietly.

**This is not a hydration mismatch**, so the SSR-vs-DOM diff below finds
nothing: both renders are identical and correct, and the damage happens
on the first *update* after them. The tell is the assertion — run the
suspect page under `dx serve`, not against the bundle.

Key on an identity the data layer guarantees unique, not on a display
string that merely usually differs:

- **A book is keyed by `books.id`.** Never by `row_ident`, the landing
  page's Playwright testid slug: it is cut from the file's *basename*, so
  `vol.epub` under two folders slugs two books alike. A testid may
  collide; a key may not. Most surfaces write `book.id` inline;
  `landing::sorting::row_diff_key` is the landing grid and table's
  named form of it.
- **Anything stored per format carries the format** — progress is
  `UNIQUE(user_id, book_uuid, format)`, so a dual-format book open in
  both formats is two rows under one uuid, and the uuid it is filed
  under is not always the one the book resolves to (`merged_uuids`).
  `landing::resume_meta::resume_key` owns that rule for every list of
  open books.

Both shipped as #2633: a four-book shelf holding one colliding pair took
the landing page's nav and shelf cards down on the first click after it
was selected.

## Confirming a mismatch

1. Reproduce via the [`ui-validate`](../skills/ui-validate/SKILL.md) skill
   (it drives the real SSR + hydration path), then
   `mcp__Claude_Preview__preview_console_logs` — Dioxus logs hydration
   errors there.
2. Diff the SSR HTML (`curl -s http://127.0.0.1:$OMNIBUS_PORT/<route>`)
   against the hydrated DOM (`preview_snapshot`). A subtree present in one
   but not the other, or in a different order, is the culprit.
3. Find the gate: search the offending component for
   `#[cfg(feature = "web"/"mobile"/"server")]` around rsx, and check any
   signal initialized differently per target.

## Fixing

Pull the cfg gate out of the rsx and into the post-mount effect;
initialize signals to a target-agnostic value and reconcile in an effect.
[frontend/src/view_prefs.rs](../../frontend/src/view_prefs.rs) (SSR
defaults that match first-hydration markup) and the
`frontend/src/components/auth/` primitives ("SSR/WASM identical for
hydration") are the worked examples to mirror.
