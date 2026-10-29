# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

The native SwiftUI client. Users, purpose, positioning, brand and principles are shared with the web app and live in the root [PRODUCT.md](../PRODUCT.md); this file records only what is specific to iOS.

## Users

The same self-hosting households, on their phones. The iPhone is where reading and listening happen away from the desk: commuting, in the kitchen, in bed. It's also the scanner in your hand for checking in physical books.

## Product Purpose

Put the whole household library in your pocket, including when the server is out of reach. Success means a reader picks up the book they were in, at the right place, whether they last read on the web, a Kobo or this phone, and that downloaded books keep working with no connection.

## Operating Context

- Signs in to the household's own Omnibus server; there is no Omnibus account or cloud in between.
- Talks to the server only through the `/api/*` REST API. The models are hand-mirrored from the server's wire types, so a contract change shows up at runtime rather than at build time.
- Distributed through TestFlight while it is open for testing.
- Home Screen widgets show what you're reading from a shared App Group snapshot, so they render with no network and with the app closed.

## Capabilities and Constraints

- The EPUB reader is epub.js inside a WebView, because iOS has no EPUB renderer and the server's CFI positions come from epub.js. Everything around it (chrome, gestures, sheets, persistence) is native.
- Comics (CBZ) page natively, from the server or from a downloaded archive.
- The audiobook player streams and has a car mode for glanceable controls. Books can be downloaded for offline reading and listening. Reading state written offline syncs back later; configuration never queues offline.
- Per-book accent colors come from the server as OKLCH and are converted to sRGB in one shared place, so the app and the widgets never draw one book in two colors.
- Barcode scanning for ISBN check-in and the wishlist.
- The deployment target is the current iOS release (26.4); there is no support for older iOS versions.

## Accessibility & Inclusion

- VoiceOver labels on controls, and Reduce Motion respected where the app animates; both are established practice.
- Open decision: Dynamic Type. Most text uses fixed `.system(size:)` fonts today, so it doesn't scale with the reader's text size.
