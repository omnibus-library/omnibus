---
paths: "frontend-js/**"
---
# 12 — Loading states

Every surface that waits draws from one vocabulary:
[`Loading.tsx`](../../frontend-js/src/components/Loading/Loading.tsx) for the
markup, [`Loading.css`](../../frontend-js/src/components/Loading/Loading.css)
for the visuals. **Never hand-roll a spinner, a pulse keyframe, or a bare
"Loading…" line** — four copy-pasted ring spinners and a hundred ad-hoc
placeholders are what this replaced.

## Pick the kind by the shape it fills

| Kind | Fills | Mark |
|---|---|---|
| `<Loading kind="page">` | `main` under the nav, centred in the height left, while a route's data or chunk loads (never on the library, which uses skeletons) | riffle (the open book), large |
| `<Loading kind="stage">` | an opaque cover over a reader/player stage; a `title` above the caption, retry in `children` | riffle, or `mark="line"` for audio |
| `<Loading kind="sheet">` | a modal, sheet or drawer body | the line |
| `<Loading kind="section">` | a card, panel or status line (the default; `inline` sits in running text) | the line |
| `<Loading kind="row">` | one list row, a "load more" | the ring |

The smaller pieces:

- **`BusyLabel`** for a button that works: swaps to the busy label with a
  ring and holds the wider width so the button never jumps. The caller still
  sets `disabled` and `aria-busy` on the `<button>`.
- **`Skeleton` / `CoverSkeletons` / `RowSkeletons`** when the content's shape
  is known — a placeholder where the real rows will land beats a centred mark.
- **A value that hasn't loaded** is never rendered as off or empty: add
  `ld-unknown` to the (disabled) settings input — the knob waiting at centre
  on a `.settings-switch`, a sheen on a text field — `ld-toggle-unknown` to a
  custom switch track, and `ld-sheen` to a pending status word.
  **`Stale`** keeps content on screen, dimmed, while it refetches.
- `Ring`, `Line`, `Riffle` are the primitives; reach for them only inside a
  composite that none of the above fits.

Carry a site's existing `data-testid` through the `testId` prop —
specs and JS observers (`lib-load-more`, `picker-load-more`) select on them.

## Unknown is not empty, and not forbidden

A fetch in flight renders loading — never the empty or zero state it would
settle into. "0 books", "No sessions found.", an unchecked box, a
"forbidden" notice: each is a claim, and making it before the data arrives is
a false statement the reader acts on. So the state must be able to say
*not loaded yet*: branch on the query's `isPending` (or `data === undefined`)
before reading its value, never on a default like `data ?? []`.

The same holds for permission gates: whether the reader is an admin is
unknown until the session answers. `RequireAuth` resolves the session before
any signed-in route renders, so `useCurrentUser()` is always the real user
below it; a gate that reads anything else (a setting, a household role) shows
loading until that answers, and only a settled "no" renders the forbidden
notice.

## Before the app mounts

There is no boot screen: `index.html` ships an empty `#root`, and the first
paint is React's. Two things run before it, so the page never flashes the
wrong state:

- An inline script in `index.html` sets the saved theme on `<html>` before
  the stylesheet paints.
- `watchImageLoads` (`imageWatch.ts`, called from `main.tsx`) installs the
  capture-phase image-load listener the cover fade keys on (below).

Route chunks load behind `<Suspense fallback={<Loading kind="page|stage">}>`
(`chunk` in `router.tsx`), so a lazy route waits under the same vocabulary.
**Playwright:** a page object's `open` waits for `#root > *` (`waitForApp`),
then for the page's own ready locator.

## Motion

- Everything that travels goes left to right, the direction of reading.
- Block loaders and skeleton plates enter after `--ld-hold`, so a fetch that
  settles inside it paints nothing rather than a flash (skeletons still hold
  their space from the first frame).
- A cover's `<img>` stays transparent until `img[data-loaded]`, then fades in
  over its plate, and the glint stops on the same stamp — set by
  `watchImageLoads`' capture-phase listener once the image decodes. Hiding it
  is the point: a browser draws an image as its bytes arrive, and may paint
  the missing rows white. Never key loading visuals on a per-image `onLoad`:
  a cached image can finish before the handler attaches, and the event is
  gone.
- Under `prefers-reduced-motion` nothing travels: marks hold still and breathe
  opacity. This applies to **every** animation in the app, not only loaders —
  a new keyframe ships with its reduced-motion override.
- Loading keyframes live in `Loading.css` only. A loading visual added to a
  page's stylesheet is how the four duplicate spinners happened.
