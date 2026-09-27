//  ReaderSelectionGeometryTests.swift
//  The selection's bars, measured off real text in a real WKWebView.
//
//  `SelectionRowsTests` pins where two bars meet; this pins the measurement
//  under it — each bar's line box, from the computed line heights of the text
//  and of the block it is set in — which only a layout engine can answer. A
//  plain page is enough: `lineRects` needs no book, so this evaluates the
//  bundled glue beside hand-built markup rather than booting epub.js.

import Foundation
import Testing
import WebKit

@testable import omnibus

/// Long enough to wrap to several lines in any of the blocks below.
private let prose = String(
    repeating: "The lagoon lay still under a low grey sky and the boats rode at anchor. ",
    count: 3
)

/// A paragraph, a line either side of a 200px plate, a paragraph set in a
/// smaller span, and two paragraphs a 1em margin apart. The line height is
/// set on `body` as a number, the way the reader's own override arrives.
private let markup = """
<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 20px; font: 18px/1.6 Georgia, serif; }
  p { margin: 0; }
  #plate { display: block; height: 200px; }
  #second { margin-top: 1em; }
</style>
</head><body>
<p id="para">\(prose)</p>
<p id="before">One line above the plate.</p>
<div id="plate"></div>
<p id="after">One line below it.</p>
<p id="small"><span style="font-size: 0.8em">\(prose)</span></p>
<p id="first">\(prose)</p>
<p id="second">\(prose)</p>
</body></html>
"""

/// What the page measures: the bars `lineRects` paints for a selection, and
/// the text boxes of the lines under it.
private let measure = """
const reader = window.OmnibusReader;
const el = (id) => document.getElementById(id);
const texts = (node) => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const out = [];
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
};
const spanning = (from, to) => {
  const first = texts(from)[0];
  const last = texts(to)[texts(to).length - 1];
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.length);
  return range;
};
// The font box of each line: one per line, however many runs it holds.
const lines = (node) => {
  const out = [];
  for (const text of texts(node)) {
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const r of Array.from(range.getClientRects())) {
      const line = out.find((l) => Math.abs(l.top - r.top) < 2);
      if (line) { line.bottom = Math.max(line.bottom, r.bottom); continue; }
      out.push({ top: r.top, bottom: r.bottom });
    }
  }
  return out;
};
const selection = (from, to) => ({
  bars: reader.lineRects(spanning(el(from), el(to)), window)
    .map((b) => ({ y: b.y, height: b.height })),
  texts: lines(el(from)).concat(from === to ? [] : lines(el(to))),
});
const plate = el("plate").getBoundingClientRect();
return JSON.stringify({
  lineHeight: parseFloat(getComputedStyle(el("para")).lineHeight),
  para: selection("para", "para"),
  plate: selection("before", "after"),
  plateBox: { top: plate.top, bottom: plate.bottom },
  small: selection("small", "small"),
  acrossBreak: selection("first", "second"),
  firstLines: lines(el("first")).length,
});
"""

private struct Box: Decodable {
    let top: Double
    let bottom: Double
    var height: Double { bottom - top }
}

private struct Bar: Decodable {
    let y: Double
    let height: Double
    var bottom: Double { y + height }
}

private struct Selection: Decodable {
    let bars: [Bar]
    let texts: [Box]
}

private struct Measured: Decodable {
    let lineHeight: Double
    let para: Selection
    let plate: Selection
    let plateBox: Box
    let small: Selection
    let acrossBreak: Selection
    let firstLines: Int
}

/// WebKit's first process launch is what a starved CI runner is slow at — see
/// `processLaunchBudget` in `ReaderEmbeddedFontTests`.
private let loadBudget: Duration = .seconds(240)

/// Load the markup, evaluate the bundled glue over it, and measure.
@MainActor
private func measured() async throws -> Measured {
    let url = try #require(
        ReaderWebView.Coordinator.bundledAssetURL(named: "epub-reader-glue.js"),
        "epub-reader-glue.js is not in the app bundle"
    )
    let glue = try String(contentsOf: url, encoding: .utf8)
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 1600))
    defer { webView.stopLoading() }
    webView.loadHTMLString(markup, baseURL: nil)

    let deadline = ContinuousClock.now + loadBudget
    var ready = false
    // The markup's own element, not just `readyState`: the initial
    // `about:blank` reads `complete` too, and a glue evaluated into it is
    // gone once the real document commits.
    let loaded = "document.readyState === 'complete' && !!document.getElementById('plate')"
    while !ready, ContinuousClock.now < deadline {
        ready = (try? await webView.evaluateJavaScript(loaded)) as? Bool ?? false
        if !ready { try await Task.sleep(for: .milliseconds(50)) }
    }
    try #require(ready, "the page never finished loading within \(loadBudget)")

    // A trailing value, so the evaluation has a result to bridge back.
    _ = try await webView.evaluateJavaScript(glue + "\n;true")
    let json = try #require(
        try await webView.callAsyncJavaScript(measure, arguments: [:], contentWorld: .page) as? String
    )
    return try JSONDecoder().decode(Measured.self, from: Data(json.utf8))
}

/// Whether each bar ends exactly where the next begins.
private func contiguous(_ bars: [Bar]) -> Bool {
    zip(bars, bars.dropFirst()).allSatisfy { abs($0.bottom - $1.y) < 0.001 }
}

@Suite("Selection geometry in the WebView", .serialized)
@MainActor
struct SelectionGeometryTests {
    @Test("lineRects paints a paragraph as one block, its ends on their own line boxes")
    func lineRectsClosesAParagraph() async throws {
        let page = try await measured()
        let para = page.para
        let first = try #require(para.texts.first)
        let last = try #require(para.texts.last)
        let firstBar = try #require(para.bars.first)
        let lastBar = try #require(para.bars.last)
        let leading = page.lineHeight - first.height

        #expect(para.texts.count >= 3, "the paragraph did not wrap: \(para.texts)")
        #expect(para.bars.count == para.texts.count)
        #expect(contiguous(para.bars), "a stripe of page between two lines: \(para.bars)")
        #expect(firstBar.y >= first.top - leading)
        #expect(lastBar.bottom <= last.bottom + leading)
    }

    @Test("lineRects paints nothing over a plate between two selected lines")
    func lineRectsSkipsAPlate() async throws {
        let page = try await measured()
        let bars = page.plate.bars

        try #require(bars.count == 2, "expected a bar either side of the plate: \(bars)")
        // The lines sit flush against the plate, and a line box computed from
        // the line height can land a fraction of a pixel off the one laid out.
        let rounding = 1.0
        #expect(bars[0].bottom <= page.plateBox.top + rounding)
        #expect(bars[1].y >= page.plateBox.bottom - rounding)
        for bar in bars {
            #expect(bar.height <= page.lineHeight + 0.5, "a bar taller than its line: \(bar)")
        }
    }

    @Test("lineRects closes a paragraph set in a smaller span on its block's line height")
    func lineRectsClosesASmallerSpan() async throws {
        let small = try await measured().small

        #expect(small.texts.count >= 3, "the paragraph did not wrap: \(small.texts)")
        #expect(contiguous(small.bars), "a stripe of page between two lines: \(small.bars)")
    }

    @Test("lineRects leaves the margin between two paragraphs unpainted")
    func lineRectsLeavesAParagraphBreakOpen() async throws {
        let page = try await measured()
        let bars = page.acrossBreak.bars
        let end = page.firstLines

        try #require(end >= 1 && bars.count > end, "no line either side of the break: \(bars)")
        // The 18px margin, less at most the seam `settleLineBoxes` closes.
        #expect(bars[end].y - bars[end - 1].bottom >= 16)
    }
}
