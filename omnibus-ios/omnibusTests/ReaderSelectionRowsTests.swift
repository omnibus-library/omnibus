//  ReaderSelectionRowsTests.swift
//  Where the selection's bars meet, run through the glue that draws them.
//
//  `getClientRects` hands the glue one font box per line; each bar is drawn on
//  its line box instead, grown by the half-leading the text's own line height
//  sets. `settleLineBoxes` then decides where two neighbouring bars meet. The
//  bars used to be grown by the gaps between them, which met across an
//  illustration and tinted the whole plate (#2649). The arithmetic is pure, so
//  it runs here in a bare JavaScriptCore context, loaded from the same bundled
//  file the reader ships: no second copy of it to drift from the one on the page.

import Foundation
import JavaScriptCore
import Testing

@testable import omnibus

/// One line of a selection, as `lineRows` hands it to `settleLineBoxes`: its
/// text box and the line box around it.
private struct Row: Equatable {
    var col: Int
    var top: Double
    var bottom: Double
    var lineTop: Double
    var lineBottom: Double

    /// A line whose box reaches `lead` past its text above and below.
    init(col: Int = 0, top: Double, bottom: Double, lead: Double) {
        self.col = col
        self.top = top
        self.bottom = bottom
        lineTop = top - lead
        lineBottom = bottom + lead
    }

    init(col: Int, top: Double, bottom: Double, lineTop: Double, lineBottom: Double) {
        self.col = col
        self.top = top
        self.bottom = bottom
        self.lineTop = lineTop
        self.lineBottom = lineBottom
    }
}

/// A 22px font box, which is what an 18px face measures in the reader.
private let fontBox = 22.0
/// The pitch of those lines at the reader's default 1.6 line height.
private let pitch = 28.8
/// How far each line box reaches past its text: half the leading.
private let halfLeading = (pitch - fontBox) / 2

/// A run of consecutive lines down one column, from `top`.
private func paragraph(lines: Int, from top: Double, col: Int = 0) -> [Row] {
    (0 ..< lines).map { i in
        let y = top + Double(i) * pitch
        return Row(col: col, top: y, bottom: y + fontBox, lead: halfLeading)
    }
}

/// Run `rows` through the bundled glue's `settleLineBoxes`.
///
/// A fresh context per call keeps the tests independent — `JSContext.exception`
/// is sticky — and costs a few milliseconds.
@MainActor
private func settleLineBoxes(_ rows: [Row]) throws -> [Row] {
    let url = try #require(
        ReaderWebView.Coordinator.bundledAssetURL(named: "epub-reader-glue.js"),
        "epub-reader-glue.js is not in the app bundle"
    )
    let context = try #require(JSContext())
    // The glue touches no DOM until `init`, so a global to hang itself off is
    // everything it needs to load.
    context.evaluateScript("var window = this;")
    context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
    try #require(context.exception == nil, "the glue threw while loading: \(String(describing: context.exception))")
    let settle = try #require(
        context.objectForKeyedSubscript("OmnibusReader")?.objectForKeyedSubscript("settleLineBoxes")
    )
    let input = rows.map {
        [
            "col": $0.col, "top": $0.top, "bottom": $0.bottom,
            "lineTop": $0.lineTop, "lineBottom": $0.lineBottom,
        ] as [String: Any]
    }
    let output = settle.call(withArguments: [input])?.toArray()
    try #require(context.exception == nil, "settleLineBoxes threw: \(String(describing: context.exception))")
    return try #require(output).map { item in
        let row = try #require(item as? [String: Any])
        return try Row(
            col: #require(row["col"] as? Int),
            top: #require(row["top"] as? Double),
            bottom: #require(row["bottom"] as? Double),
            lineTop: #require(row["lineTop"] as? Double),
            lineBottom: #require(row["lineBottom"] as? Double)
        )
    }
}

/// Equal to within float noise.
private func nearlyEqual(_ a: Double, _ b: Double) -> Bool {
    abs(a - b) < 1e-6
}

@Suite("Selection rows")
@MainActor
struct SelectionRowsTests {
    @Test("settleLineBoxes paints nothing over an illustration between two selected lines")
    func settleLineBoxesSkipsAnIllustration() throws {
        // The measurement in #2649: a 200px plate, a line either side of it.
        // The two bars used to grow 263px tall and meet across it.
        let above = Row(top: 295.5, bottom: 317.5, lead: halfLeading)
        let below = Row(top: 558.5, bottom: 580.5, lead: halfLeading)
        let plate = 338.5 ... 538.5

        let bars = try settleLineBoxes([above, below])

        #expect(bars == [above, below])
        #expect(bars[0].lineBottom < plate.lowerBound)
        #expect(bars[1].lineTop > plate.upperBound)
        for bar in bars {
            #expect(nearlyEqual(bar.lineBottom - bar.lineTop, pitch))
        }
    }

    @Test("settleLineBoxes paints a paragraph as one continuous block")
    func settleLineBoxesClosesAParagraph() throws {
        let bars = try settleLineBoxes(paragraph(lines: 4, from: 100))

        for (upper, lower) in zip(bars, bars.dropFirst()) {
            #expect(nearlyEqual(upper.lineBottom, lower.lineTop), "a stripe of page between two lines")
        }
        for bar in bars {
            #expect(nearlyEqual(bar.lineBottom - bar.lineTop, pitch))
        }
    }

    @Test("settleLineBoxes closes a paragraph whose lines land a hair apart or a hair over")
    func settleLineBoxesAbsorbsSubPixelRounding() throws {
        // Lines placed on the layout grid rather than at exact multiples of
        // the pitch: one pair a fraction apart, the next a fraction over.
        let rows = [
            Row(top: 100, bottom: 122, lead: halfLeading),
            Row(top: 129.2, bottom: 151.2, lead: halfLeading),
            Row(top: 157.7, bottom: 179.7, lead: halfLeading),
        ]

        let bars = try settleLineBoxes(rows)

        for (upper, lower) in zip(bars, bars.dropFirst()) {
            #expect(nearlyEqual(upper.lineBottom, lower.lineTop))
        }
    }

    @Test("settleLineBoxes keeps both ends of a range on their own line boxes")
    func settleLineBoxesKeepsTheEndsOnTheirLineBoxes() throws {
        let rows = paragraph(lines: 3, from: 100)

        let bars = try settleLineBoxes(rows)

        let first = try #require(bars.first)
        let last = try #require(bars.last)
        #expect(nearlyEqual(first.lineTop, rows[0].top - halfLeading))
        #expect(nearlyEqual(last.lineBottom, rows[2].bottom + halfLeading))
    }

    @Test("settleLineBoxes leaves the margin between two paragraphs unpainted")
    func settleLineBoxesLeavesAParagraphBreakOpen() throws {
        // A 1em margin between the last line of one paragraph and the first of
        // the next. Neither end may grow toward the unselected lines around it,
        // at any line height.
        let margin = 18.0
        let last = Row(top: 100, bottom: 122, lead: halfLeading)
        let first = Row(top: 122 + 2 * halfLeading + margin, bottom: 144 + 2 * halfLeading + margin,
                        lead: halfLeading)

        let bars = try settleLineBoxes([last, first])

        #expect(bars == [last, first])
        #expect(nearlyEqual(bars[1].lineTop - bars[0].lineBottom, margin))
    }

    @Test("settleLineBoxes paints nothing over an ornament shorter than a line")
    func settleLineBoxesSkipsAShortOrnament() throws {
        // A 16px dinkus between two lines, no margins: shorter than a line,
        // and still page.
        let above = Row(top: 100, bottom: 122, lead: halfLeading)
        let below = Row(top: 122 + 2 * halfLeading + 16, bottom: 144 + 2 * halfLeading + 16,
                        lead: halfLeading)

        let bars = try settleLineBoxes([above, below])

        #expect(bars == [above, below])
    }

    @Test("settleLineBoxes never grows a line into its neighbour")
    func settleLineBoxesSharesOneEdge() throws {
        // A line whose box reaches further down — a taller inline run on it —
        // overlapping the next line's box. They meet at one edge between the
        // two texts rather than painting a doubled band.
        let upper = Row(top: 100, bottom: 122, lead: 8)
        let lower = Row(top: 128.8, bottom: 150.8, lead: halfLeading)

        let bars = try settleLineBoxes([upper, lower])

        #expect(nearlyEqual(bars[0].lineBottom, bars[1].lineTop))
        #expect(bars[0].lineBottom >= upper.bottom)
        #expect(bars[1].lineTop <= lower.top)
    }

    @Test("settleLineBoxes treats each column of a spread on its own")
    func settleLineBoxesKeepsColumnsApart() throws {
        // A range across the spread's gutter: the right column's first line is
        // level with the left's, and is no neighbour of it.
        let left = paragraph(lines: 3, from: 100, col: 0)
        let right = paragraph(lines: 1, from: 100, col: 1)

        let bars = try settleLineBoxes(left + right)

        #expect(bars.last == right[0])
    }

    @Test("settleLineBoxes leaves tightly set lines as measured")
    func settleLineBoxesLeavesOverlappingTextAlone() throws {
        // A line height under the font box: no leading, and texts that overlap.
        let rows = [
            Row(top: 100, bottom: 122, lead: 0),
            Row(top: 121, bottom: 143, lead: 0),
        ]

        let bars = try settleLineBoxes(rows)

        #expect(bars == rows)
    }
}
