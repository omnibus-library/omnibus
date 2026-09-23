//  ReaderBackdropTests.swift
//  The ground decision behind the PDF chrome's ink.
//
//  Pinned here because the whole fix is these small functions: page or stage,
//  light or dark — and every uncertain answer must keep the ink the reader
//  has always had rather than flip a row nobody asked to flip.

import CoreGraphics
import Foundation
import SwiftUI
import Testing

@testable import omnibus

private let control = CGRect(x: 20, y: 700, width: 272, height: 46)

private func ground(page: CGRect?, luminance: Double?) -> ReaderGround {
    ReaderBackdrop.ground(control: control, pageFrame: page) { _ in luminance }
}

@Suite("Reader backdrop")
struct ReaderBackdropTests {
    @Test("no page on screen keeps the stage's ink")
    func noPage() {
        #expect(ground(page: nil, luminance: 1) == .stage)
    }

    @Test("a control clear of the page keeps the stage's ink")
    func controlOffPage() {
        let page = CGRect(x: 20, y: 100, width: 272, height: 400)
        #expect(ground(page: page, luminance: 1) == .stage)
    }

    @Test("a control fully over white paper takes the page's ink")
    func overWhitePaper() {
        #expect(ground(page: control, luminance: 0.95) == .page)
    }

    @Test("a control over dark page content keeps the stage's ink")
    func overDarkContent() {
        #expect(ground(page: control, luminance: 0.2) == .stage)
    }

    @Test("clipping the page's edge is not enough to flip the ink")
    func straddleBelowFloor() {
        // ~24% coverage: the row is over the stage for reading purposes.
        let page = CGRect(x: 20, y: 665, width: 272, height: 46)
        #expect(ground(page: page, luminance: 1) == .stage)
    }

    @Test("a clear overlap of white paper flips the row")
    func straddleAboveFloor() {
        // ~46% coverage of the row.
        let page = CGRect(x: 20, y: 675, width: 272, height: 46)
        #expect(ground(page: page, luminance: 0.9) == .page)
    }

    @Test("an unreadable sample keeps the stage's ink")
    func luminanceUnavailable() {
        #expect(ground(page: control, luminance: nil) == .stage)
    }
}

@Suite("Reader backdrop ink")
struct ReaderBackdropInkTests {
    @Test("the stage keeps white ink on dark glass")
    func stageInk() {
        #expect(ReaderGround.stage.ink == .white)
        #expect(ReaderGround.stage.scheme == .dark)
    }

    @Test("the page flips ink and glass together")
    func pageInk() {
        #expect(ReaderGround.page.ink == ReaderTheme.ink("light"))
        #expect(ReaderGround.page.scheme == .light)
    }
}

@Suite("Reader backdrop luminance")
struct ReaderBackdropLuminanceTests {
    @Test("white reads as one")
    func white() {
        #expect(ReaderBackdrop.meanLuminance(of: grey(1)) > 0.95)
    }

    @Test("black reads as zero")
    func black() {
        #expect(ReaderBackdrop.meanLuminance(of: grey(0)) < 0.05)
    }

    @Test("mid grey reads as about a half")
    func midGrey() {
        #expect(abs(ReaderBackdrop.meanLuminance(of: grey(0.5)) - 0.5) < 0.12)
    }

    @Test("green weighs more than blue, sRGB-style")
    func weighting() {
        #expect(ReaderBackdrop.meanLuminance(of: channels(g: 1)) > 0.6)
        #expect(ReaderBackdrop.meanLuminance(of: channels(b: 1)) < 0.2)
    }

    private func grey(_ value: CGFloat) -> CGImage {
        channels(r: value, g: value, b: value)
    }

    private func channels(r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0) -> CGImage {
        let size = 8
        guard let context = CGContext(
            data: nil,
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: size * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            fatalError("test context")
        }
        context.setFillColor(red: r, green: g, blue: b, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))
        guard let image = context.makeImage() else { fatalError("test image") }
        return image
    }
}
