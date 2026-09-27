//  ReaderSelectionRowsTests.swift
//  How tall the selection's bars are, run through the glue that draws them.
//
//  `getClientRects` hands the glue one font box per line, and `fillLeading`
//  grows those over the leading between them so a paragraph reads as one block.
//  Growing across a gap that was not leading — an illustration between two
//  selected lines — tinted the whole plate and the blank page under it (#2649).
//  The arithmetic is pure, so it runs here in a bare JavaScriptCore context,
//  loaded from the same bundled file the reader ships: no second copy of it to
//  drift from the one on the page.

import Foundation
import JavaScriptCore
import Testing

@testable import omnibus

/// One line of a selection, as `lineRows` hands it to `fillLeading`.
private struct Row: Equatable {
    var col = 0
    var top: Double
    var bottom: Double

    var height: Double { bottom - top }
}

/// A 22px font box, which is what an 18px face measures in the reader.
private let fontBox = 22.0
/// The pitch of those lines at the reader's default 1.6 line height.
private let pitch = 28.8
/// The stripe of page `getClientRects` leaves between two lines of a paragraph.
private let leading = pitch - fontBox

/// A run of consecutive lines down one column, from `top`.
private func paragraph(lines: Int, from top: Double, col: Int = 0) -> [Row] {
    (0 ..< lines).map { i in
        let y = top + Double(i) * pitch
        return Row(col: col, top: y, bottom: y + fontBox)
    }
}

/// Run `rows` through the bundled glue's `fillLeading`.
@MainActor
private func fillLeading(_ rows: [Row]) throws -> [Row] {
    let url = try #require(
        ReaderWebView.Coordinator.bundledAssetURL(named: "epub-reader-glue.js"),
        "epub-reader-glue.js is not in the app bundle"
    )
    let context = try #require(JSContext())
    // The glue touches no DOM until `init`, so a global to hang itself off is
    // everything it needs to load.
    context.evaluateScript("var window = this;")
    context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
    if let exception = context.exception {
        Issue.record("the glue threw while loading: \(exception)")
    }
    let fill = try #require(
        context.objectForKeyedSubscript("OmnibusReader")?.objectForKeyedSubscript("fillLeading")
    )
    let input = rows.map { ["col": $0.col, "top": $0.top, "bottom": $0.bottom] as [String: Any] }
    let output = try #require(fill.call(withArguments: [input])?.toArray())
    if let exception = context.exception {
        Issue.record("fillLeading threw: \(exception)")
    }
    return try output.map { item in
        let row = try #require(item as? [String: Any])
        return try Row(
            col: #require(row["col"] as? Int),
            top: #require(row["top"] as? Double),
            bottom: #require(row["bottom"] as? Double)
        )
    }
}

/// Equal to within float noise: the growth is a sum of halves.
private func nearlyEqual(_ a: Double, _ b: Double) -> Bool {
    abs(a - b) < 1e-6
}

@Suite("Selection rows")
@MainActor
struct SelectionRowsTests {
    @Test("fillLeading paints nothing over an illustration between two selected lines")
    func fillLeadingSkipsAnIllustration() throws {
        // The measurement in #2649: a 200px plate, a line either side of it. The
        // two bars used to grow 263px tall and meet across it.
        let above = Row(top: 295.5, bottom: 317.5)
        let below = Row(top: 558.5, bottom: 580.5)
        let plate = 338.5 ... 538.5

        let bars = try fillLeading([above, below])

        #expect(bars == [above, below])
        #expect(bars[0].bottom < plate.lowerBound)
        #expect(bars[1].top > plate.upperBound)
    }

    @Test("fillLeading keeps the lines either side of an illustration to one line box")
    func fillLeadingHoldsBarsBesideAnIllustrationToALineBox() throws {
        // Leading measured above the plate, so the lines beside it grow — by
        // the paragraph's own leading, not by the plate.
        let lead = paragraph(lines: 3, from: 237.9)
        let below = Row(top: 558.5, bottom: 580.5)
        let plate = 338.5 ... 538.5

        let bars = try fillLeading(lead + [below])

        for bar in bars {
            #expect(bar.height <= fontBox + leading + 1e-6)
        }
        #expect(bars[2].bottom < plate.lowerBound)
        #expect(bars[3].top > plate.upperBound)
        #expect(nearlyEqual(bars[3].top, below.top - leading / 2))
        #expect(nearlyEqual(bars[3].bottom, below.bottom + leading / 2))
    }

    @Test("fillLeading paints a paragraph as one continuous block")
    func fillLeadingClosesAParagraph() throws {
        let rows = paragraph(lines: 4, from: 100)

        let bars = try fillLeading(rows)

        for (upper, lower) in zip(bars, bars.dropFirst()) {
            #expect(nearlyEqual(upper.bottom, lower.top), "a stripe of page between two lines")
        }
        for bar in bars {
            #expect(nearlyEqual(bar.height, pitch))
        }
    }

    @Test("fillLeading grows neither end of a range past its own line box")
    func fillLeadingKeepsTheEndsInsideTheirLineBoxes() throws {
        let rows = paragraph(lines: 3, from: 100)

        let bars = try fillLeading(rows)

        let first = try #require(bars.first)
        let last = try #require(bars.last)
        #expect(first.top >= rows[0].top - leading)
        #expect(last.bottom <= rows[2].bottom + leading)
        #expect(nearlyEqual(first.top, rows[0].top - leading / 2))
        #expect(nearlyEqual(last.bottom, rows[2].bottom + leading / 2))
    }

    @Test("fillLeading never grows a row into its neighbour")
    func fillLeadingStopsAtTheNeighbour() throws {
        // A display line's generous leading sets the half-leading, and the
        // gap below it is too wide to be the small lines' leading but narrower
        // than that half-leading on each side.
        let display = [Row(top: 0, bottom: 36), Row(top: 56, bottom: 92)]
        let small = [Row(top: 108, bottom: 120), Row(top: 136, bottom: 148)]

        let bars = try fillLeading(display + small)

        for (upper, lower) in zip(bars, bars.dropFirst()) {
            #expect(upper.bottom <= lower.top + 1e-6, "a bar grew into the next one")
        }
    }

    @Test("fillLeading treats each column of a spread on its own")
    func fillLeadingKeepsColumnsApart() throws {
        // A range across the spread's gutter: the right column's first line
        // is level with the left's first, and has no line above it to meet.
        let left = paragraph(lines: 3, from: 100, col: 0)
        let right = paragraph(lines: 1, from: 100, col: 1)

        let bars = try fillLeading(left + right)

        let opening = try #require(bars.last)
        #expect(opening.col == 1)
        #expect(nearlyEqual(opening.top, 100 - leading / 2))
        #expect(nearlyEqual(opening.bottom, 100 + fontBox + leading / 2))
    }

    @Test("fillLeading leaves tightly set lines as measured")
    func fillLeadingLeavesOverlappingLinesAlone() throws {
        // A line height under the font box leaves no stripe to close.
        let rows = [Row(top: 100, bottom: 122), Row(top: 121, bottom: 143)]

        let bars = try fillLeading(rows)

        #expect(bars == rows)
    }
}
