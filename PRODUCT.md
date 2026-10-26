# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The web app has two clients on one design system: the Dioxus app (`frontend/`, the default) and the opt-in React client (`frontend-js/`). The native iOS app keeps its own product record in [omnibus-ios/PRODUCT.md](omnibus-ios/PRODUCT.md). The Android app is a WebView shell (`mobile/`) around this web app.

## Users

Self-hosting households. One person runs Omnibus on a home server for everyone in the house, and is a reader too, not only its admin. Each member has their own account and reads and listens across a laptop, a phone and an e-reader. They pick up where they left off on whichever device is at hand, keep their own shelves and goals, and can share reading stats with the rest of the household.

## Product Purpose

Omnibus indexes the ebooks and audiobooks already on the owner's disk and gives them a home: a cover wall to browse, a reader that keeps your place, a player that knows its chapters, and no account anywhere except your own server. Success means a household moves its reading into Omnibus and stops needing a hosted reading service, without ever being asked to hand its files over.

## Positioning

- **One book, every format.** An ebook and its audiobook are one record. Read forty pages, listen for an hour, and the position carries across: by chapter when the chapter counts match, by percentage when they don't. Linking formats is opt-in.
- **Your files, untouched.** The scanner only reads the library folders. Metadata edits are saved in the database and applied when a book is exported or sent out.
- **Reach to every device.** A native iOS app, Kobo sync that serves KEPUB, KOReader progress sync, Send to Kindle over the owner's SMTP, and an Android shell.
- **Talk to your library.** A built-in MCP server lets the owner's own AI agent search, curate, merge and repair the library. It is off until an admin enables it.

## Operating Context

- Deployed as a Docker image (`sesloan/omnibus`) with a Jellyfin-style `docker-compose.yml`. The first account registered is the admin.
- Libraries are existing folders, often Calibre-organized, mounted into the container. The Author/Title layout scans as-is, metadata is read from inside each file rather than Calibre's `metadata.opf`, and nothing on disk is moved or renamed.
- Used daily for reading (EPUB, PDF, CBZ) and listening (M4B, MP3, streamed through an HLS transcode), plus browsing by author, series, tag and shelf.
- Physical books are tracked too: scan an ISBN to check in a copy you own, or add it to a wishlist.
- Every client speaks one REST API under `/api/`; its OpenAPI document is the contract.

## Capabilities and Constraints

- Multi-user with per-account progress, shelves (including smart shelves), highlights, bookmarks, journal entries, reviews, reading goals and stats; household readers can opt in to share stats.
- Admin surfaces: library sources, maintenance, metadata providers, cleanup, people, integrations, health and logs.
- Metadata is looked up from external providers, with every change previewed, applied and reversible.
- Content state can be written offline and synced later; configuration and commands never queue offline.
- Spoilers are bounded by the reader's own position: figures round conservatively, and nothing past where the reader is gets shown.
- Licensed MIT.

## Brand Commitments

- The name is **Omnibus**. The brand mark is the stoat (`frontend/assets/omnibus-stoat.png`), shown in the top bar and on the sign-in pages.
- Tagline: "A library that belongs entirely to you."
- The voice is plain and warm, writing to a reader rather than an operator, and it never oversells.

## Evidence on Hand

- Product screenshots: `docs/screenshots/hero.png` (web and iOS) and the marketing site's stills in `site/src/shots/`.
- The marketing site (`site/`), published at <https://omnibus-library.github.io/omnibus/>.
- Public-domain fixture books and audiobooks for demos and tests (`just fixtures`).
- No testimonials, user counts, press or benchmarks exist. Don't invent any.

## Product Principles

- **Ownership first.** Nothing leaves the owner's server unless they send it, and their files are never modified.
- **A book is the unit, not a file.** Formats, copies and devices all hang off one book and one reading position.
- **Meet readers on their devices.** Sync with the e-readers and phones people already own instead of replacing them.
- **Reversible by default.** Merges, metadata changes and agent edits can all be undone.
- **Households, not tenants.** Accounts are people who live together: private by default, shared by choice.

## Accessibility & Inclusion

- Every animation respects `prefers-reduced-motion`, which is a repo rule for loaders and entrances.
- Each of the four themes (dark, black, light, sepia) is checked separately for text contrast; muted labels target about 3.5:1 or better.
- Unknown and loading states are never drawn as empty or forbidden.
