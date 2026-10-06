//  PageCurlTests.swift
//  The page curl's model: the order UIKit turns through a page's two sides,
//  the snapshot ring a landed turn leaves, where a spread's spine falls, what
//  each side draws, and where a tap the curl can't draw goes.

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

/// A two-point snapshot of a spread, one colour a page, at one pixel a point.
private func spread(_ left: UIColor, _ right: UIColor) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: 2, height: 1), format: format).image {
        context in
        left.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
        right.setFill()
        context.fill(CGRect(x: 1, y: 0, width: 1, height: 1))
    }
}

/// An image's colour, averaged down to one RGBA pixel.
private func rgba(_ image: UIImage?) throws -> [UInt8] {
    let cgImage = try #require(image?.cgImage)
    var pixel = [UInt8](repeating: 0, count: 4)
    let context = try #require(
        CGContext(
            data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
    )
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    return pixel
}

private func front(_ offset: Int) -> CurlSide { CurlSide(offset: offset, isSecond: false) }
private func back(_ offset: Int) -> CurlSide { CurlSide(offset: offset, isSecond: true) }

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

    @Test("a single column turns about its edge and a spread about its middle; nothing else curls")
    func layoutTurnsAColumnAboutItsEdgeAndASpreadAboutItsMiddle() {
        #expect(CurlLayout(columns: 1)?.spineLocation == .min)
        #expect(CurlLayout(columns: 2)?.spineLocation == .mid)
        #expect(CurlLayout(columns: 3) == nil)
        #expect(CurlLayout(columns: nil) == nil)
    }

    @Test("a spread curls over the widest band its spine is the middle of")
    func spreadFrameIsCentredOnTheSpine() {
        let stage = CGRect(x: 0, y: 0, width: 900, height: 600)

        #expect(CurlLayout.spread.frame(in: stage, spine: 450) == stage)
        #expect(
            CurlLayout.spread.frame(in: stage, spine: 460)
                == CGRect(x: 20, y: 0, width: 880, height: 600)
        )
    }

    @Test("a single column shows its front, and a spread both its halves")
    func shownIsTheFrontOrBothHalves() {
        #expect(CurlLayout.single.shown(at: 1) == [front(1)])
        #expect(CurlLayout.spread.shown(at: 1) == [front(1), back(1)])
    }

    @Test("a single column turns over the current page going forward, the incoming one coming back")
    func singleTurnTakesTheLandingFrontAndTheTurningBack() {
        #expect(CurlLayout.single.turn(1) == [front(1), back(0)])
        #expect(CurlLayout.single.turn(-1) == [front(-1), back(-1)])
    }

    @Test("a spread turns to the whole spread it lands on, either way")
    func spreadTurnTakesTheLandingSpread() {
        #expect(CurlLayout.spread.turn(1) == [front(1), back(1)])
        #expect(CurlLayout.spread.turn(-1) == [front(-1), back(-1)])
    }

    @Test("a single column, or a spread whose spine is unknown, curls over the whole stage")
    func frameIsTheStageWithoutASpine() {
        let stage = CGRect(x: 0, y: 0, width: 900, height: 600)

        #expect(CurlLayout.single.frame(in: stage, spine: 460) == stage)
        #expect(CurlLayout.spread.frame(in: stage, spine: nil) == stage)
        #expect(CurlLayout.spread.frame(in: stage, spine: 900) == stage)
    }

    @MainActor
    @Test("a page's back is its paper, with the print mirrored through it")
    func backDrawsThePaperWithTheMirroredPrint() throws {
        let paper = UIColor(ReaderTheme.pageColor("sepia"))
        let page = CurlPageController(
            image: snapshot(.black), side: back(0), layout: .single, paper: paper
        )

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
            image: snapshot(.black), side: front(0), layout: .single, paper: .white
        )

        let print = try #require(page.view.subviews.first as? UIImageView)

        #expect(print.alpha == 1)
        #expect(print.image?.imageOrientation == .up)
    }

    /// The back of a sheet turning in a spread is the next spread's left page,
    /// which UIKit puts there itself — so neither half is a mirrored back.
    @MainActor
    @Test("a spread's sides are its snapshot's halves, either side of the spine")
    func spreadSidesDrawTheHalvesOfTheSnapshot() throws {
        let image = spread(.red, .blue)
        let left = CurlPageController(
            image: image, side: front(0), layout: .spread, paper: .white
        )
        let right = CurlPageController(
            image: image, side: back(0), layout: .spread, paper: .white
        )

        let leftPrint = try #require(left.view.subviews.first as? UIImageView)
        let rightPrint = try #require(right.view.subviews.first as? UIImageView)

        #expect(try rgba(leftPrint.image) == [255, 0, 0, 255])
        #expect(try rgba(rightPrint.image) == [0, 0, 255, 255])
        #expect(leftPrint.image?.size == CGSize(width: 1, height: 1))
        #expect(rightPrint.alpha == 1)
        #expect(rightPrint.image?.imageOrientation == .up)
    }
}

@Suite("Page curl pager")
@MainActor
struct PageCurlPagerTests {
    private func installed() -> (UIView, PageCurlHost) {
        let stage = UIView(frame: CGRect(x: 0, y: 0, width: 900, height: 600))
        let curl = PageCurlHost()
        curl.install(on: stage)
        return (stage, curl)
    }

    /// The pager's pan lives on the stage; a swap must not leave the old one.
    private func pans(on stage: UIView) -> Int {
        (stage.gestureRecognizers ?? []).filter { $0 is UIPanGestureRecognizer }.count
    }

    @Test("a spread swaps in a pager spined in the middle, over the band about the spine")
    func fitSpreadSwapsInAMidSpinePager() {
        let (stage, curl) = installed()
        let single = curl.pager

        curl.fit(.spread, spine: 460)

        #expect(curl.pager !== single)
        #expect(curl.pager.spineLocation == .mid)
        #expect(curl.pager.view.superview === stage)
        #expect(single.view.superview == nil)
        #expect(curl.pager.view.frame == CGRect(x: 20, y: 0, width: 880, height: 600))
        #expect(pans(on: stage) == 1)
    }

    @Test("back to a single column swaps an edge-spined pager in over the whole stage")
    func fitSingleSwapsBackToAnEdgeSpinePager() {
        let (stage, curl) = installed()
        curl.fit(.spread, spine: 460)

        curl.fit(.single, spine: nil)

        #expect(curl.pager.spineLocation == .min)
        #expect(curl.pager.view.frame == stage.bounds)
        #expect(pans(on: stage) == 1)
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
