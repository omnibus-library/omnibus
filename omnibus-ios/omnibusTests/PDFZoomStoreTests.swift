//  PDFZoomStoreTests.swift
//  The per-book PDF zoom blob: what a book's zoom round-trips as, and what
//  every uncertain payload must read as — none, never a crash.

import Foundation
import Testing

@testable import omnibus

/// A fresh defaults suite per test, cleaned up after — the store's real
/// backing is `UserDefaults.standard`, which tests must not touch.
private func scratchDefaults() -> (defaults: UserDefaults, clean: () -> Void) {
    let name = "pdf-zoom-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    return (defaults, { defaults.removePersistentDomain(forName: name) })
}

@Suite("PDF zoom store")
struct PDFZoomStoreTests {
    @Test("a book with no stored zoom reads as fit")
    func emptyStore() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == nil)
    }

    @Test("a zoom round-trips for its book")
    func roundTrip() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        PDFZoomStore.setZoom(2.5, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == 2.5)
    }

    @Test("books do not share zooms")
    func perBookIsolation() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        PDFZoomStore.setZoom(2.5, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-b", defaults: defaults) == nil)
        PDFZoomStore.setZoom(3.5, for: "book-b", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == 2.5)
        #expect(PDFZoomStore.zoom(for: "book-b", defaults: defaults) == 3.5)
    }

    @Test("clearing a zoom returns the book to fit")
    func clearing() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        PDFZoomStore.setZoom(2.5, for: "book-a", defaults: defaults)
        PDFZoomStore.setZoom(nil, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == nil)
    }

    @Test("a zoom past the ceiling clamps to it")
    func clampsHigh() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        PDFZoomStore.setZoom(12, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == PDFZoomStore.maxZoom)
    }

    @Test("a zoom at or under fit reads as fit")
    func clampsLow() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        PDFZoomStore.setZoom(1.0, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == nil)
        PDFZoomStore.setZoom(1.01, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == nil)
    }

    @Test("a non-finite zoom is refused, not read as a clear")
    func nonFinite() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        PDFZoomStore.setZoom(2.0, for: "book-a", defaults: defaults)
        PDFZoomStore.setZoom(.nan, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == 2.0)
        PDFZoomStore.setZoom(.infinity, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == 2.0)
    }

    @Test("a payload the decoder cannot read reads as fit, and heals on write")
    func corruptPayload() {
        let (defaults, clean) = scratchDefaults()
        defer { clean() }
        defaults.set(Data("not json".utf8), forKey: PDFZoomStore.storageKey)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == nil)
        PDFZoomStore.setZoom(2.0, for: "book-a", defaults: defaults)
        #expect(PDFZoomStore.zoom(for: "book-a", defaults: defaults) == 2.0)
    }
}

@Suite("PDF zoom settle")
struct PDFZoomSettleTests {
    @Test("a pinch past fit settles to its multiple")
    func pastFit() {
        #expect(PDFZoomStore.settledZoom(forMultiple: 2.5) == 2.5)
    }

    @Test("a pinch past the ceiling settles clamped")
    func pastCeiling() {
        #expect(PDFZoomStore.settledZoom(forMultiple: 12) == PDFZoomStore.maxZoom)
    }

    @Test("a pinch at or under fit settles to none")
    func underFit() {
        #expect(PDFZoomStore.settledZoom(forMultiple: 1.0) == nil)
        #expect(PDFZoomStore.settledZoom(forMultiple: 1.01) == nil)
    }

    @Test("a non-finite multiple settles to none")
    func nonFinite() {
        #expect(PDFZoomStore.settledZoom(forMultiple: .nan) == nil)
        #expect(PDFZoomStore.settledZoom(forMultiple: .infinity) == nil)
    }
}
