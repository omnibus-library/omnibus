//  ReaderFollowSeekTests.swift
//  The reader's half of cross-format follow (#2942).
//
//  The follow jump's answer reaches the reader before the book has loaded, and
//  the glue parks it through the locations pass, so the seek is held until the
//  glue reports it settled — a page rebooted meanwhile gets it again. And a
//  close that re-saved the unmoved landing stamped a fresh clock on it,
//  out-ordering the newer audiobook position at the clock gate. `ReaderView`'s
//  `persist` is a SwiftUI method and can't be driven from here, so its guard
//  is pinned at its input: `ReaderController.unsavedCFI`.

import Foundation
import Testing

@testable import omnibus

private let landing = "epubcfi(/6/2!/4/10/1:219)"
private let turnedTo = "epubcfi(/6/2!/4/12/1:0)"

@MainActor
private func bootedReader() -> ReaderController {
    let controller = ReaderController()
    controller.configure(
        book: Book(id: 1, filename: "golden-son.epub", title: "Golden Son", uniqueIdentifier: "book-uuid"),
        startCFI: landing,
        highlights: []
    )
    controller.handle(message: ["type": "hostReady"])
    return controller
}

@MainActor
private func ready(_ controller: ReaderController) {
    controller.handle(message: ["type": "status", "payload": "ready"])
}

/// A relocate as the glue posts it, naming the last seek it settled.
@MainActor
private func relocate(_ controller: ReaderController, to cfi: String, settledSeek: Int?) throws {
    let data = RelocateData(cfi: cfi, settledSeek: settledSeek)
    let json = String(decoding: try JSONEncoder().encode(data), as: UTF8.self)
    controller.handle(message: ["type": "relocate", "payload": json])
}

@MainActor
private func seeksSent(_ controller: ReaderController) -> [String] {
    controller.evaluatedScripts.filter { $0.hasPrefix("OmnibusReader.seek(") }
}

@Suite("Reader follow seek")
@MainActor
struct ReaderFollowSeekTests {
    @Test("a seek before the page is ready waits for it")
    func seekWaitsForReady() {
        let controller = bootedReader()
        controller.seek(toFraction: 0.86)
        #expect(seeksSent(controller).isEmpty)

        ready(controller)
        #expect(seeksSent(controller) == ["OmnibusReader.seek(0.86, 1)"])
    }

    @Test("a seek on a ready page goes straight through")
    func seekOnReadyPage() {
        let controller = bootedReader()
        ready(controller)
        controller.seek(toFraction: 1.4)
        #expect(controller.evaluatedScripts.last == "OmnibusReader.seek(1.0, 1)")
    }

    /// The glue parks the seek through a locations pass that takes seconds on
    /// a first open; WebContent reclaimed in that window reboots the page.
    @Test("a seek the glue never settled goes again to a rebooted page")
    func unsettledSeekSurvivesReboot() throws {
        let controller = bootedReader()
        controller.seek(toFraction: 0.86)
        ready(controller)
        // Posted before the glue took the seek, so it names none.
        try relocate(controller, to: landing, settledSeek: nil)

        controller.handle(message: ["type": "hostReady"])
        ready(controller)
        #expect(seeksSent(controller) == ["OmnibusReader.seek(0.86, 1)", "OmnibusReader.seek(0.86, 1)"])
    }

    @Test("a seek the glue settled is not sent again")
    func settledSeekIsDone() throws {
        let controller = bootedReader()
        controller.seek(toFraction: 0.86)
        ready(controller)
        try relocate(controller, to: turnedTo, settledSeek: 1)
        #expect(controller.pendingSeek == nil)

        controller.handle(message: ["type": "hostReady"])
        ready(controller)
        #expect(seeksSent(controller).count == 1)
    }

    /// Accepting a sync offer while the follow jump waits on the page: the
    /// reader's explicit choice must not be overwritten when `ready` lands.
    @Test("a jump the reader chose drops a held seek")
    func displayDropsHeldSeek() {
        let controller = bootedReader()
        controller.seek(toFraction: 0.86)
        controller.display(turnedTo)
        ready(controller)
        #expect(seeksSent(controller).isEmpty)
        #expect(controller.pendingSeek == nil)
    }

    @Test("an echo or the spot already saved is nothing to save")
    func unmovedIsNotSaved() {
        // The restore settling on the stored page, under any CFI spelling.
        #expect(unsaved(RelocateData(cfi: turnedTo, echo: true), saved: landing) == nil)
        #expect(unsaved(RelocateData(cfi: landing, echo: false), saved: landing) == nil)
        #expect(unsaved(nil, saved: landing) == nil)
    }

    @Test("a move off the saved spot is saved")
    func moveIsSaved() {
        #expect(unsaved(RelocateData(cfi: turnedTo, echo: false), saved: landing) == turnedTo)
        // A held seek never blocks the reader's own move.
        #expect(unsaved(RelocateData(cfi: turnedTo, echo: false), saved: nil, seekPending: true) == turnedTo)
    }

    /// A never-read book: the host skips its first relocate, and the locations
    /// pass re-states that landing as an echo, which is all a close then finds.
    @Test("a first open's landing is saved, even as an echo")
    func firstLandingIsSaved() {
        #expect(unsaved(RelocateData(cfi: landing, echo: false), saved: nil) == landing)
        #expect(unsaved(RelocateData(cfi: landing, echo: true), saved: nil) == landing)
    }

    /// The server's read missed the open's deadline, so the book opened at the
    /// start over a position another device may hold.
    @Test("an unmoved landing is not saved while the server's read is out")
    func landingWaitsOnRemote() {
        #expect(unsaved(RelocateData(cfi: landing, echo: true), saved: nil, stored: .unsettled) == nil)
    }

    /// The late answer became an offer, which never moves `savedCFI`.
    @Test("an unmoved landing is not saved over a position the server holds")
    func landingYieldsToRemote() {
        #expect(unsaved(RelocateData(cfi: landing, echo: true), saved: nil, stored: .somewhere) == nil)
    }

    /// Closed between the locations pass and the follow jump's relocate.
    @Test("an unmoved landing is not saved while a follow seek is held")
    func landingWaitsOnSeek() {
        #expect(unsaved(RelocateData(cfi: landing, echo: true), saved: nil, seekPending: true) == nil)
    }

    @Test("the open finds a position stored nowhere only when neither side holds one")
    func storedSettlesFromBothSides() {
        let row = ProgressRecord(bookUUID: "book-uuid", format: .epub, epubCFI: landing, updatedAt: 100)
        let empty = ProgressRecord(bookUUID: "book-uuid", format: .epub, updatedAt: 100)
        #expect(PositionSync.Stored(local: nil, remote: nil) == .nowhere)
        #expect(PositionSync.Stored(local: empty, remote: nil) == .nowhere)
        #expect(PositionSync.Stored(local: nil, remote: row) == .somewhere)
        #expect(PositionSync.Stored(local: row, remote: nil) == .somewhere)
    }
}

@MainActor
private func unsaved(
    _ location: RelocateData?, saved: String?,
    stored: PositionSync.Stored = .nowhere, seekPending: Bool = false
) -> String? {
    ReaderController.unsavedCFI(location: location, saved: saved, stored: stored, seekPending: seekPending)
}
