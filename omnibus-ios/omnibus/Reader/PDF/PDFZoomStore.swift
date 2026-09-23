//  PDFZoomStore.swift
//  The zoom a reader left a PDF at, remembered per book.
//
//  The stage keeps `PDFView.scaleFactor` as the source of truth while a book
//  is open; what has to outlive a page turn — and the reader itself — is the
//  multiple of fit-to-screen the reader settled on. Stored as one JSON blob
//  under a UserDefaults key, the same shape and the same upgrade posture as
//  the reader's typography blob: a payload the decoder cannot read reads as
//  "no zoom" rather than failing the open.

import Foundation

enum PDFZoomStore {
    /// One blob, like `omnibus.readerSettings` — book uuid to zoom multiple.
    /// Unlike that fixed-shape blob, this one grows a key per zoomed book
    /// and never prunes; harmless at library scale, but it is the kind that
    /// eventually wants one.
    static let storageKey = "omnibus.pdfZoom"

    /// Far enough in for an 8-point footnote, far enough out to not strand a
    /// reader in a corner of a page.
    static let maxZoom = 6.0

    /// Below this, a settled pinch is fit — the same threshold the stage
    /// uses, kept here so the read and write paths agree.
    static let fitEpsilon = 1.02

    /// The zoom multiple a settled pinch leaves behind: kept past fit,
    /// clamped to the ceiling, `nil` at or under it — and `nil` for values
    /// that are not finite numbers at all.
    static func settledZoom(forMultiple multiple: Double) -> Double? {
        guard multiple.isFinite, multiple > fitEpsilon else { return nil }
        return min(multiple, maxZoom)
    }

    /// The zoom multiple stored for a book, if any.
    static func zoom(for bookUUID: String, defaults: UserDefaults = .standard) -> Double? {
        guard let stored = payload(defaults)[bookUUID] else { return nil }
        return clamp(stored)
    }

    /// Store — or, at fit, clear — the zoom for a book. A non-finite write
    /// is refused outright rather than treated as a clear: it is a caller
    /// bug, not a request to forget.
    static func setZoom(_ zoom: Double?, for bookUUID: String, defaults: UserDefaults = .standard) {
        var stored = payload(defaults)
        if let zoom {
            guard zoom.isFinite else { return }
            if let clamped = clamp(zoom) {
                stored[bookUUID] = clamped
            } else {
                stored.removeValue(forKey: bookUUID)
            }
        } else {
            stored.removeValue(forKey: bookUUID)
        }
        guard let data = try? JSONEncoder().encode(stored) else { return }
        defaults.set(data, forKey: storageKey)
    }

    /// A stored multiple, clamped to the zoom range — `nil` for anything at
    /// or under fit, and for payloads that are not finite numbers.
    private static func clamp(_ zoom: Double) -> Double? {
        guard zoom.isFinite else { return nil }
        guard zoom > fitEpsilon else { return nil }
        return min(zoom, maxZoom)
    }

    private static func payload(_ defaults: UserDefaults) -> [String: Double] {
        guard let data = defaults.data(forKey: storageKey),
              let stored = try? JSONDecoder().decode([String: Double].self, from: data)
        else { return [:] }
        return stored
    }
}
