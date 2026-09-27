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
| `Loading { kind: Page }` | `main` under the nav, centred in the height left, while a route's data loads (never on the library, which uses skeletons) | riffle (the open book), large |
| `Loading { kind: Stage }` | an opaque cover over a reader/player stage; a `title` above the caption, retry in `children` | riffle, or `mark: Line` for audio |
| `Loading { kind: Sheet }` | a modal, sheet or drawer body | the line |
| `Loading { kind: Section }` | a card, panel or status line (the default) | the line |
| `Loading { kind: Row }` | one list row, a "load more" | the ring |

The smaller pieces:

- **`BusyLabel`** for a button that works: swaps to the busy label with a
  ring and holds the wider width so the button never jumps. The caller still
  sets `disabled` and `aria-busy` on the `<button>`.
- **`Skeleton` / `CoverSkeletons` / `RowSkeletons`** when the content's shape
  is known — a placeholder where the real rows will land beats a centred mark.
- **A value that hasn't loaded** is never rendered as off or empty: add
  `ld-unknown` to the (disabled) checkbox — a dash on a plain checkbox, the
  knob waiting at centre on a `.settings-switch` — `ld-toggle-unknown` to a
  custom switch track, and `ld-sheen` to a pending status word. `ld-dot` is
  the breathing dot for background work. **`Stale`** keeps content on screen,
  dimmed, while it refetches.
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
non-admin and for a user not yet resolved, so a gate uses `use_admin_access()`
/ `use_upload_access()` instead: `Access::Unknown` renders loading, and only
`Denied` renders the forbidden notice. Fetches and polls wait for `Allowed`.

## Before hydration

There is no boot screen. Until the WASM client hydrates, the reader sees the
server-rendered page — nav included — so SSR must already draw the loading
state the client will: the library's skeletons, the `Page` loader everywhere
else. The same nodes are then adopted by hydration and carry straight through
to content. This is why the false-empty rule above is load-bearing: anything
SSR renders as empty is on screen, inert, for as long as the download takes.

`BootScript` (the app root's first child) paints the saved theme before first
paint and installs the image-load listener; `use_hydration_marker` stamps
`data-hydrated` on `<html>` once the client mounts. Two rules follow:

- **Never read `data-hydrated` in rsx.** It exists outside the vdom so SSR and
  the first client paint stay identical (rule 07); only CSS and tests key on it.
- **Playwright:** `gotoReady` waits for the marker, then `networkidle` — the
  marker is what proves handlers are attached. To pin the pre-hydration page,
  hold the app's `omnibus_bg*.wasm` (`boot.spec.ts`), not a `/wasm/` path:
  `dx serve` serves it from `/wasm/`, the release bundle CI runs from a hashed
  `/assets/` name. Navigate with `waitUntil: "domcontentloaded"` while held.

## Motion

- Everything that travels goes left to right, the direction of reading.
- Block loaders and skeleton plates enter after `--ld-hold`, so a fetch that
  settles inside it paints nothing rather than a flash (skeletons still hold
  their space from the first frame).
- The cover glint stops on `img[data-loaded]`, stamped by a capture-phase load
  listener `BootScript` installs. Never key loading visuals on an `onload`
  handler: an SSR'd image can finish before hydration and the event is gone.
- Under `prefers-reduced-motion` nothing travels: marks hold still and breathe
  opacity. This applies to **every** animation in the app, not only loaders —
  a new keyframe ships with its reduced-motion override.
- Loading keyframes live in `loading.css` only. A loading visual added to
  `atrium.css` is how the four duplicate spinners happened.
