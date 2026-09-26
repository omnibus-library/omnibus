# 12 — Loading states

Every surface that waits draws from one vocabulary:
[`components/loading.rs`](../../frontend/src/components/loading.rs) for the
markup, [`assets/loading.css`](../../frontend/assets/loading.css) for the
visuals. **Never hand-roll a spinner, a pulse keyframe, or a bare
"Loading…" line** — four copy-pasted ring spinners and a hundred ad-hoc
placeholders are what this replaced (#2641).

## Pick the kind by the shape it fills

| Kind | Fills | Mark |
|---|---|---|
| `Loading { kind: Page }` | `main` under the nav, while a route's data loads | riffle (the open book) |
| `Loading { kind: Stage }` | an opaque cover over a reader/player stage; retry goes in `children` | riffle, or `mark: Line` for audio |
| `Loading { kind: Sheet }` | a modal, sheet or drawer body | the line |
| `Loading { kind: Section }` | a card, panel or status line (the default) | the line |
| `Loading { kind: Row }` | one list row, a "load more" | the ring |

The smaller pieces:

- **`BusyLabel`** for a button that works: swaps to the busy label with a
  ring and holds the wider width so the button never jumps. The caller still
  sets `disabled` and `aria-busy` on the `<button>`.
- **`Skeleton` / `CoverSkeletons` / `RowSkeletons`** when the content's shape
  is known — a placeholder where the real rows will land beats a centred mark.
- **`UnknownToggle`** for a switch whose state hasn't loaded — never render it
  as off. **`ActivityPill`** for non-blocking background work. **`Stale`** to
  keep content on screen, dimmed, while it refetches.
- `Ring`, `Line`, `Riffle` are the primitives; reach for them only inside a
  composite that none of the above fits.

Carry a converted site's existing `data-testid` through the `testid` prop —
specs and JS observers (`lib-load-more`, `picker-load-more`) select on them.

## Unknown is not empty, and not forbidden

A fetch in flight renders loading — never the empty or zero state it would
settle into. "0 books", "No sessions found.", an unchecked box, a
"forbidden" notice: each is a claim, and making it before the data arrives is
a false statement the reader acts on. So the state must be able to say
*not loaded yet*: an `Option` that is `None` until the first answer, or a
`loaded` flag set when the request **returns**, never when it is sent.

The same holds for permission gates. `use_is_admin()` is `false` both for a
non-admin and for a user not yet resolved; a gate must read the raw
`CurrentUser` (outer `None` = unresolved) and show loading until it knows.

## The boot screen

`BootScreen` is mounted once at the app root and covers the server-rendered
shell until the WASM client hydrates; the client's first effect stamps
`data-hydrated` on `<html>` and CSS dismisses it. Two rules follow:

- **Never read `data-hydrated` in rsx.** It exists outside the vdom so SSR and
  the first client paint stay identical (rule 07); only CSS and tests key on it.
- **Playwright:** `gotoReady` waits for the marker, then `networkidle` — the
  marker is what proves handlers are attached. A spec that holds `/wasm/*`
  (`boot.spec.ts`) must navigate with `waitUntil: "domcontentloaded"`: the
  bundle is an async module script, so `load` never fires while it's held.

## Motion

- Everything that travels goes left to right, the direction of reading.
- Block loaders enter after `--ld-hold`, so a fetch that settles inside it
  paints nothing rather than a flash.
- Under `prefers-reduced-motion` nothing travels: marks hold still and breathe
  opacity. This applies to **every** animation in the app, not only loaders —
  a new keyframe ships with its reduced-motion override.
- Loading keyframes live in `loading.css` only. A loading visual added to
  `atrium.css` is how the four duplicate spinners happened.
