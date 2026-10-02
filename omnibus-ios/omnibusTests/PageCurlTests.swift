//  PageCurlTests.swift
//  The page curl's model: the order UIKit turns through a page's two sides,
//  the snapshot ring a landed turn leaves, what each side draws, and where a
//  tap the curl can't draw goes.

import SwiftUI
import Testing
import UIKit

@testable import omnibus

/// A one-point image, so snapshots can be told apart by identity.
private func snapshot(_ color: UIColor) -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1)).image { context in
        color.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
}

private func front(_ offset: Int) -> CurlSide { CurlSide(offset: offset, isBack: false) }
private func back(_ offset: Int) -> CurlSide { CurlSide(offset: offset, isBack: true) }

@Suite("Page curl")
struct PageCurlTests {
    private let around = CurlSequence(offsets: [-1, 0, 1])

    @Test("forward from a page turns to its back, then the next page's front")
    func sequenceAfterWalksFrontThenBackThenNextFront() {
        #expect(around.after(front(0)) == back(0))
        #expect(around.after(back(0)) == front(1))
    }

    @Test("back from a page turns to the previous page's back, then its front")
    func sequenceBeforeWalksPreviousBackThenFront() {
        #expect(around.before(front(0)) == back(-1))
        #expect(around.before(back(-1)) == front(-1))
    }

    @Test("the sequence ends where the snapshots do")
    func sequenceEndsAtAMissingSnapshot() {
        let forwardOnly = CurlSequence(offsets: [0, 1])

        #expect(forwardOnly.before(front(0)) == nil)
        #expect(forwardOnly.after(back(1)) == nil)
    }

    @Test("a forward landing puts the next page in front and the old one behind it")
    func landedForwardShiftsTheRing() {
        let (previous, current, next) = (snapshot(.red), snapshot(.green), snapshot(.blue))
        var pages = CurlPages(current: current)
        pages[-1] = previous
        pages[1] = next

        let landed = pages.landed(1)

        #expect(landed[0] === next)
        #expect(landed[-1] === current)
        #expect(landed[1] == nil)
    }

    @Test("a backward landing puts the previous page in front and the old one after it")
    func landedBackwardShiftsTheRing() {
        let (previous, current) = (snapshot(.red), snapshot(.green))
        var pages = CurlPages(current: current)
        pages[-1] = previous

        let landed = pages.landed(-1)

        #expect(landed[0] === previous)
        #expect(landed[1] === current)
        #expect(landed[-1] == nil)
    }

    /// A chapter's first page has no neighbour snapshot: the curl crossed first
    /// and brought a snapshot of where it landed.
    @Test("a landing across a chapter keeps the page it brought")
    func landedAcrossAChapterKeepsTheDestination() {
        let (current, crossed) = (snapshot(.green), snapshot(.blue))

        let landed = CurlPages(current: current).landed(1, destination: crossed)

        #expect(landed[0] === crossed)
        #expect(landed[-1] === current)
    }

    @Test("only a single column curls; a spread or an unknown layout slides")
    func layoutCurlsASingleColumnOnly() {
        #expect(CurlLayout(columns: 1) == .single)
        #expect(CurlLayout(columns: 2) == .spread)
        #expect(CurlLayout(columns: nil) == .spread)
    }

    @MainActor
    @Test("a page's back is its paper, with the print mirrored through it")
    func backDrawsThePaperWithTheMirroredPrint() throws {
        let paper = UIColor(ReaderTheme.pageColor("sepia"))
        let page = CurlPageController(image: snapshot(.black), side: back(0), paper: paper)

        let print = try #require(page.view.subviews.first as? UIImageView)

        #expect(page.view.backgroundColor == paper)
        // `alpha` round-trips through a Float.
        #expect(abs(print.alpha - CurlPageController.showThrough) < 0.001)
        #expect(print.image?.imageOrientation == .upMirrored)
    }

    @MainActor
    @Test("a page's front is the snapshot as captured")
    func frontDrawsTheSnapshotUnchanged() throws {
        let page = CurlPageController(
            image: snapshot(.black), side: front(0), paper: .white
        )

        let print = try #require(page.view.subviews.first as? UIImageView)

        #expect(print.alpha == 1)
        #expect(print.image?.imageOrientation == .up)
    }
}

@Suite("Page curl taps")
@MainActor
struct PageCurlTapTests {
    /// A controller with a curl attached, so a tap reaches the host.
    private func curledReader() -> (ReaderController, PageCurlHost) {
        let controller = ReaderController(settings: ReaderSettings())
        let curl = PageCurlHost()
        curl.controller = controller
        controller.pageCurl = curl
        return (controller, curl)
    }

    @Test("a gutter tap the curl can't draw is the glue's slide")
    func turnRequestFallsBackToTheSlide() {
        let (controller, curl) = curledReader()

        // The controller holds its curl weakly; the stage owns it in the app.
        withExtendedLifetime(curl) {
            controller.handle(message: ["type": "turnRequest", "payload": "-1"])
        }

        #expect(controller.evaluatedScripts.last == "OmnibusReader.turnSlide(-1)")
    }

    @Test("a turn request naming no direction is dropped")
    func turnRequestWithoutADirectionIsDropped() {
        let (controller, curl) = curledReader()

        withExtendedLifetime(curl) {
            controller.handle(message: ["type": "turnRequest", "payload": "0"])
            controller.handle(message: ["type": "turnRequest", "payload": "next"])
        }

        #expect(controller.evaluatedScripts.isEmpty)
    }
}
