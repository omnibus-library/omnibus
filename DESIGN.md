---
name: Omnibus
description: A self-hosted reading room for your ebooks and audiobooks.
colors:
  accent: "oklch(0.78 0.13 65)"
  accent-soft: "oklch(0.30 0.07 65)"
  accent-ink: "oklch(0.16 0.02 65)"
  bg-0: "oklch(0.135 0.006 70)"
  bg-1: "oklch(0.175 0.008 70)"
  bg-2: "oklch(0.215 0.010 70)"
  bg-3: "oklch(0.265 0.011 70)"
  line: "oklch(0.30 0.010 70 / 0.65)"
  line-2: "oklch(0.30 0.010 70 / 0.30)"
  ink-0: "oklch(0.97 0.006 80)"
  ink-1: "oklch(0.82 0.010 75)"
  ink-2: "oklch(0.62 0.012 70)"
  ink-3: "oklch(0.48 0.012 70)"
  ok: "oklch(0.78 0.13 150)"
  warn: "oklch(0.78 0.13 75)"
  bad: "oklch(0.72 0.16 25)"
  cover-fallback-bg: "oklch(0.30 0.004 70)"
  cover-fallback-ink: "oklch(0.92 0.004 70)"
typography:
  display:
    fontFamily: "Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: "70px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: "46px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: "31px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.005em"
  subtitle:
    fontFamily: "Cormorant Garamond, EB Garamond, Georgia, serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, -apple-system, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.005em"
    fontFeature: "lnum"
  meta:
    fontFamily: "Instrument Sans, ui-sans-serif, -apple-system, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Space Mono, ui-monospace, SF Mono, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    letterSpacing: "0.14em"
  nav:
    fontFamily: "Space Mono, ui-monospace, SF Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.09em"
rounded:
  xs: "4px"
  sm: "6px"
  input: "8px"
  md: "10px"
  lg: "14px"
  xl: "22px"
  pill: "999px"
spacing:
  gap: "18px"
  pad: "28px"
  gutter: "clamp(1.25rem, 4vw, 3.5rem)"
components:
  button:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.ink-0}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.bg-3}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.bg-1}"
    textColor: "{colors.ink-0}"
  chip:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  chip-selected:
    textColor: "{colors.ink-0}"
  input:
    backgroundColor: "{colors.bg-1}"
    textColor: "{colors.ink-0}"
    rounded: "{rounded.input}"
    padding: "0.55rem 0.75rem"
  card:
    backgroundColor: "{colors.bg-1}"
    rounded: "{rounded.lg}"
    padding: "20px"
  nav-link:
    textColor: "{colors.ink-1}"
    typography: "{typography.nav}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
  nav-link-active:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.ink-0}"
  topbar:
    backgroundColor: "{colors.bg-0}"
    height: "65px"
    padding: "14px 28px"
---

# Design System: Omnibus

## Overview

**Creative North Star: "The Reading Room"**

Omnibus is a quiet, lamp-lit library. The grounds are warm near-blacks, every surface is a slightly lighter tone of the same warm neutral, and the only strong color in the chrome is a single lamplight amber. The books bring everything else: covers are the most colorful, most lifted objects on any screen, and each book can tint its own surroundings with its `accent_color`.

The voice is editorial and calm. Titles are set in Cormorant Garamond, the interface in Instrument Sans, and labels and numbers in Space Mono uppercase, like a catalogue card. Calm is not static, though: Omnibus likes motion and interactivity. Covers rise under the pointer, sheets slide in, and loaders breathe. The chrome stays quiet until it is touched, then responds.

The tokens live in the web client's `frontend-js/src/styles/theme.css`. Four themes swap the token values through `data-theme`: dark (the default, documented in the frontmatter), black, light and sepia.

**Key Characteristics:**
- Warm oklch neutrals (hue 70–80, chroma near zero) in four tonal steps, with no pure greys outside the black theme.
- One chrome accent, Lamplight Amber, used sparingly; covers carry their own color.
- A serif voice for titles, sans for interface, uppercase mono for labels.
- Layered depth: tonal steps first, then soft shadows, from cards up to covers and floating layers.
- Responsive motion that respects `prefers-reduced-motion`.

## Colors

A warm, near-monochrome room lit by one amber lamp.

### Primary
- **Lamplight Amber** (`accent`): primary buttons, the active tab, selected chip borders, focus rings, progress fills. It marks the one thing to do or the one thing that's on. In sepia it deepens to a rust amber (oklch 0.58 0.11 50) so it still reads on paper; in black it becomes a light neutral, so no hue shows.
- **Amber Wash** (`accent-soft`): the quiet fill behind accent-tinted states, such as a soft highlight or a selected row.
- **Amber Ink** (`accent-ink`): text and icons on an accent fill. Light and dark themes both need this dark ink, because white on the 0.78 L amber is only about 2:1.

### Neutral
- **Night Ground** (`bg-0`): the page itself, and the top bar under a 92% wash.
- **Shelf** (`bg-1`): cards, inputs, modals and sheets; the first lift off the ground.
- **Raised** (`bg-2`): buttons, chips, the active nav link, the search trigger.
- **Lifted** (`bg-3`): hover on raised controls; the highest tonal step.
- **Rule** (`line`) and **Faint Rule** (`line-2`): hairline borders. Faint is the resting border, and full Rule is its hover.
- **Page White** (`ink-0`), **Soft Ink** (`ink-1`), **Muted Ink** (`ink-2`), **Whisper** (`ink-3`): four text tiers, from titles down to keys, hints and axis labels. In light, Whisper sits at 0.50 L so small labels still reach about 3.5:1.

### Status
- **Moss** (`ok`), **Brass Warning** (`warn`), **Ember** (`bad`): success, caution and destructive actions. Light and sepia darken all three to about 0.45–0.50 L for contrast.

### Named Rules
**The Covers Bring the Color Rule.** Chrome stays in the warm neutrals plus one amber. Any other hue on a screen should come from a book: a cover, its per-book `--accent`, or a highlight color (amber, green, blue, rose and violet, for the reader's highlights only).

**The Neutral Plate Rule.** A book without a cover gets a neutral plate (`cover-fallback-bg` / `cover-fallback-ink`), never the accent, so a missing cover never looks like a selected one.

## Typography

**Display Font:** Cormorant Garamond (with EB Garamond, Georgia)
**Body Font:** Instrument Sans (with the system UI sans)
**Label/Mono Font:** Space Mono (with SF Mono)

**Character:** An old-style book face for anything a reader would call a title, a clean contemporary sans for everything they operate, and a typewriter mono for the catalogue details in between.

### Hierarchy
- **Display** (600, 70px, 1.0): page heroes. Page-level heroes may use `clamp(38px, 5vw, 70px)`; on phones the h1 falls to `clamp(30px, 10vw, 42px)`.
- **Headline** (600, 46px, 1.05): section heroes such as a book's title.
- **Title** (600, 31px, 1.1) and **Subtitle** (600, 22px, 1.2): card and panel titles. The most common serif size in practice is 23px.
- **Body** (400, 14px, 1.45, lining figures): all interface text. Reading copy holds a 62ch measure.
- **Meta** (12–13px sans): bylines, counts and secondary rows.
- **Label** (Space Mono 500, 10.5px, 0.14em, uppercase): section labels, table keys and field labels.
- **Nav** (Space Mono 11px, 0.09em, uppercase): top-bar links and top-bar buttons.

### Named Rules
**The Lining Figures Rule.** Numbers are data: `font-variant-numeric: lining-nums` is set app-wide, because Cormorant's old-style zero reads as a lowercase "o".

**The Upright Emphasis Rule.** `<em>` inside a heading stays upright. Emphasis in a title comes from weight or color, not italics.

## Layout

The shell is a sticky top bar over a full-width `main`, padded by a fluid gutter (`clamp(1.25rem, 4vw, 3.5rem)`). The app has no outer max-width; content blocks cap their own widths instead, mostly 560–720px for forms and dialogs and up to 1120px for wide panels. When the mini player is open, `main` gets bottom padding so the player never covers content.

Breakpoints: 720px is the phone line, the one most rules key off. 900px collapses two-pane browse layouts, and 1100px, 560px and 480px make finer adjustments. Every hover style sits inside `@media (hover: hover)`, and touch devices get the hover colors on press instead.

Rhythm: `--gap` (18px) between siblings, and `--pad` (28px) inside page-level containers.

## Elevation & Depth

Depth is layered throughout. Surfaces first separate by tone (`bg-0` → `bg-3`), then lift with soft, warm-black shadows that grow with how far an object sits from the page: cards barely, covers clearly, floating layers deeply. Shadows always mix black into the background with `color-mix(in oklch, …)`, so they stay warm on every theme.

### Shadow Vocabulary
- **Card** (`0 1px 0 color-mix(in oklch, black 22%, transparent), 0 10px 24px -14px color-mix(in oklch, black 45%, transparent)`): a resting card or panel. Adopted with this document and not yet in the CSS, which still draws cards with a border only.
- **Cover** (`filter: drop-shadow(0 18px 22px color-mix(in oklch, black 50%, transparent)) drop-shadow(0 2px 0 color-mix(in oklch, black 30%, transparent))`): every book cover at rest. On hover the first shadow grows to `0 28px 30px` at 65%.
- **Popover** (`0 18px 40px color-mix(in oklch, black 55%, transparent), 0 2px 0 color-mix(in oklch, black 25%, transparent)`): the user menu, export menus, filter popovers.
- **Modal** (`0 24px 60px color-mix(in oklch, black 55%, transparent)`): dialogs and the check-in modal, over a black 62% scrim with a 3px blur.
- **Sheet** (`0 2px 6px rgba(0,0,0,.35), 0 40px 90px -24px rgba(0,0,0,.8)`): the edit sheet over a book.
- **Player** (`0 30px 70px -16px rgba(0,0,0,.7)`): the audiobook player and mini dock, over a 20px backdrop blur.

### Named Rules
**The Distance Rule.** A shadow's size says how far the object sits from the page, from card to cover to popover to modal to sheet. Never give a lower layer a bigger shadow than a layer above it.

**The Frosted Chrome Rule.** Fixed chrome is translucent: the top bar is `bg-0` at 92% with a 10px blur.

## Shapes

Corners are gently rounded and scale with the object: 6px for small controls, 8px for inputs, 10px for buttons and chip rows, 14px for cards, 16–18px for sheets and the search panel, 22px for the largest panels. Anything that toggles or filters is a full pill (999px): chips, nav links, the search trigger. Avatars and round controls are circles.

Books are the exception and keep a book's silhouette: a 2:3 cover with `2px 4px 4px 2px` corners (the spine is squarer than the fore-edge), a shaded 8px spine on the left and a cream page sliver on the right.

## Components

### Buttons
Quiet until touched.
- **Shape:** gently rounded (10px), 36px tall, `0 14px` padding; small is 28px tall with 8px corners, large is 44px with 12px corners.
- **Default:** a Raised (`bg-2`) fill, Page White text, Faint Rule border, 13px weight 500.
- **Primary:** Lamplight Amber fill with Amber Ink text at weight 600; hover mixes in 12% white.
- **Ghost:** no fill or border, Soft Ink text; hover adds a Shelf fill and Page White text.
- **Danger:** Ember text with an Ember-tinted border; hover adds a 12% Ember wash.
- **Hover / Press:** 0.15s color and border transitions, and a 1px sink on press (`translateY(1px)`).
- **In the top bar:** Space Mono uppercase, 10.5px, 0.07em tracking.

### Chips
- **Style:** a pill with a Raised fill, Soft Ink 12px text and a Faint Rule border; a count badge sits in Whisper mono 10px.
- **State:** hover and selected both switch to Page White text and an amber border; the fill doesn't change. Genre chips carry a 45% amber border even at rest.

### Cards / Containers
- **Corner Style:** 14px (`lg`).
- **Background:** Shelf (`bg-1`).
- **Shadow Strategy:** the Card shadow (see Elevation & Depth).
- **Border:** Faint Rule, which turns to Rule on hover.
- **Internal Padding:** 20px; modals use 18–28px.

### Inputs / Fields
- **Style:** a Shelf fill, Faint Rule border, 8px corners and `0.55rem 0.75rem` padding.
- **Focus:** the border turns amber, plus a 2px outline of amber at 55%.
- **Error:** an Ember border (`aria-invalid`), with 0.8rem Ember text below. Labels are Muted Ink at 0.875rem weight 500.

### Navigation
- **Top bar:** sticky and frosted, 65px tall (61px on phones), with a serif 25px wordmark on the left. Nav links are mono uppercase pills: Soft Ink at rest, Page White on Shelf on hover, Page White on Raised when active. Links hide below 720px.
- **Search trigger:** a 36px pill showing the ⌘K hint.

### Book Cover
The most important object on any screen.
- **Form:** 2:3, book-cornered, with spine shading and a page sliver (see Shapes) and the Cover shadow.
- **Motion:** on hover it rises `translateY(-5px) scale(1.015)` over 0.35s `cubic-bezier(.2,.7,.2,1)` while its shadow deepens; on touch, a press dims it to 82% brightness.
- **Missing cover:** a neutral plate with the author in spaced uppercase sans on top and the title in balanced serif below, both sized to the cover with container units.

### Loading
Every wait draws from the shared loading kit (`frontend-js/src/components/Loading/`), and the mark follows the shape being filled: the riffle for a page or a reader stage (the line for an audio stage), the line for a section or sheet, and the ring for a row or a busy button. Content whose shape is known gets skeletons instead. Marks breathe on a 1.7s beat, and loaders that would show for less than 160ms never appear. [Rule 12](.claude/rules/12-loading-states.md) is the full guide.

## Do's and Don'ts

### Do:
- **Do** let books carry the color: the cover art, the per-book `--accent`, highlight colors.
- **Do** animate in response to people: a cover lifts, a sheet opens over 240ms (`--ease-out`, `cubic-bezier(.16,1,.3,1)`) and closes over 160ms (`--ease-in`), hovers take 0.15s.
- **Do** make surfaces respond to the reader rather than sit still; interactivity is part of the calm, not at odds with it.
- **Do** wrap every animation in `prefers-reduced-motion`; under `reduce`, loaders fade instead of moving and entrance animations don't run.
- **Do** draw keyboard focus as `outline: 2px solid var(--accent)` with a 2px offset on every interactive element, including buttons and chips.
- **Do** put labels and numbers in Space Mono uppercase, and titles in Cormorant.
- **Do** check every new color against all four themes (dark, black, light, sepia).

### Don't:
- **Don't** look like a generic SaaS dashboard: no blue primaries, no gradient hero cards, no Inter, no grids of identical KPI tiles.
- **Don't** render anything as the contents of an open book (page spreads, page curls, text laid out on a drawn book); it always looks corny.
- **Don't** use the accent as a background for anything that isn't the one primary action or the one active state.
- **Don't** introduce a shadow, radius or blur outside the vocabularies above without adding it here.
- **Don't** leave focus to the browser default or remove an outline without replacing it.
- **Don't** use pure grey or pure black outside the black theme; the neutrals are warm.
