//  ReaderFollowSeekTests.swift
//  The reader's half of cross-format follow (#2942).
//
//  The follow jump's answer reaches the reader before the book has loaded, so
//  a seek sent straight through landed on a page with nothing to jump in and
//  was lost. And a close that re-saved the unmoved landing stamped a fresh
//  clock on it, out-ordering the newer audiobook position at the clock gate.
//  `ReaderView`'s `persist` is a SwiftUI method and can't be driven from here,
//  so its guard is pinned at its input: `ReaderController.unsavedCFI`.

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

@Suite("Reader follow seek")
@MainActor
struct ReaderFollowSeekTests {
    @Test("a seek before the page is ready waits for it")
    func seekWaitsForReady() {
        let controller = bootedReader()
        controller.seek(toFraction: 0.86)
        #expect(!controller.evaluatedScripts.contains("OmnibusReader.seek(0.86)"))
        #expect(controller.pendingSeek == 0.86)

        controller.handle(message: ["type": "status", "payload": "ready"])
        #expect(controller.evaluatedScripts.contains("OmnibusReader.seek(0.86)"))
        #expect(controller.pendingSeek == nil)
    }

    @Test("a seek on a ready page goes straight through")
    func seekOnReadyPage() {
        let controller = bootedReader()
        controller.handle(message: ["type": "status", "payload": "ready"])
        controller.seek(toFraction: 1.4)
        #expect(controller.evaluatedScripts.last == "OmnibusReader.seek(1.0)")
        #expect(controller.pendingSeek == nil)
    }

    @Test("an echo or the spot already saved is nothing to save")
    func unmovedIsNotSaved() {
        // The restore settling on the stored page, under any CFI spelling.
        #expect(
            ReaderController.unsavedCFI(location: RelocateData(cfi: turnedTo, echo: true), saved: landing) == nil
        )
        #expect(
            ReaderController.unsavedCFI(location: RelocateData(cfi: landing, echo: false), saved: landing) == nil
        )
        #expect(ReaderController.unsavedCFI(location: nil, saved: landing) == nil)
    }

    @Test("a move off the saved spot is saved")
    func moveIsSaved() {
        #expect(
            ReaderController.unsavedCFI(location: RelocateData(cfi: turnedTo, echo: false), saved: landing)
                == turnedTo
        )
        // A first open has nothing saved, so its landing still goes out on close.
        #expect(
            ReaderController.unsavedCFI(location: RelocateData(cfi: landing, echo: false), saved: nil)
                == landing
        )
    }
}
