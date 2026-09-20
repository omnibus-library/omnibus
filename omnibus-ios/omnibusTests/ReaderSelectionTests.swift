//  ReaderSelectionTests.swift
//  The two contracts the host-drawn selection rests on.
//
//  The glue owns the range and reports geometry; everything the reader sees is
//  drawn from that payload. So the decode is a real interface — a renamed field
//  is a silently dead selection — and the placement maths decides whether a
//  menu covers the sentence it is about. Both are pure, and neither is obvious
//  from looking at a phone.

import CoreGraphics
import Foundation
import SwiftUI
import Testing

@testable import omnibus

private func rect(x: Double, y: Double, w: Double, h: Double) -> PageRect {
    PageRect(x: x, y: y, width: w, height: h)
}

/// A phone-sized page.
private let page = CGSize(width: 402, height: 874)
/// The passage menu's box, tail included.
private let panel = CGSize(width: AnnotationMenu.width, height: AnnotationMenu.height)

@Suite("Panel placement")
struct PanelPlacementTests {
    @Test("resolve puts the panel above a passage with room over it")
    func resolvePutsPanelAboveWhenItFits() {
        let placement = PanelPlacement.resolve(
            rects: [rect(x: 60, y: 500, w: 280, h: 24)], panel: panel, in: page
        )

        #expect(placement.tail.pointsDown)
        #expect(placement.center.y < 500)
        // Clear of the passage by the gap plus half the panel.
        #expect(placement.center.y == 500 - PanelPlacement.gap - panel.height / 2)
    }

    @Test("resolve drops the panel below a passage near the top of the page")
    func resolveDropsBelowNearTheTop() {
        let passage = rect(x: 60, y: 70, w: 280, h: 24)
        let placement = PanelPlacement.resolve(rects: [passage], panel: panel, in: page)

        #expect(!placement.tail.pointsDown)
        #expect(placement.center.y > passage.y + passage.height)
    }

    @Test("resolve keeps the panel inside the screen for a passage at the margin")
    func resolveClampsToScreenEdges() {
        let atLeft = PanelPlacement.resolve(
            rects: [rect(x: 4, y: 500, w: 40, h: 24)], panel: panel, in: page
        )
        let atRight = PanelPlacement.resolve(
            rects: [rect(x: 360, y: 500, w: 40, h: 24)], panel: panel, in: page
        )

        #expect(atLeft.center.x == panel.width / 2 + PanelPlacement.screenEdge)
        #expect(atRight.center.x == page.width - panel.width / 2 - PanelPlacement.screenEdge)
    }

    @Test("resolve keeps the tail clear of the panel's rounded corners")
    func resolveKeepsTailOffTheCorners() {
        // A passage hard against the left margin pushes the tail as far
        // leading as it can go; it must still land on the flat edge.
        let placement = PanelPlacement.resolve(
            rects: [rect(x: 0, y: 500, w: 30, h: 24)], panel: panel, in: page
        )
        let tailX = placement.tail.offset * panel.width

        #expect(tailX >= Radius.lg)
        #expect(tailX <= panel.width - Radius.lg)
    }

    @Test("resolve points the tail between the first and last line of a passage")
    func resolvePointsTailBetweenTheEnds() {
        // A selection running to the right margin on line one and stopping
        // short on line two: the tail belongs between the two, not at the
        // middle of their union.
        let placement = PanelPlacement.resolve(
            rects: [
                rect(x: 200, y: 500, w: 180, h: 24),
                rect(x: 20, y: 530, w: 100, h: 24),
            ],
            panel: panel,
            in: page
        )
        let tailX = placement.tail.offset * panel.width
        let expected = ((200 + 180 / 2.0) + (20 + 100 / 2.0)) / 2

        #expect(abs((placement.center.x - panel.width / 2 + tailX) - expected) < 0.5)
    }

    @Test("resolve falls back to the bottom of the page when there is no geometry")
    func resolveFallsBackWithoutRects() {
        let placement = PanelPlacement.resolve(rects: [], panel: panel, in: page)

        #expect(placement.center.x == page.width / 2)
        #expect(placement.center.y == page.height - panel.height / 2 - PanelPlacement.chromeBand)
        #expect(placement.tail == .none)
    }

    @Test("anchorPoint puts the menu's origin at the tail's tip")
    func anchorPointSitsOnTheTailTip() {
        let below = PanelTail(pointsDown: true, offset: 0.3)
        let above = PanelTail(pointsDown: false, offset: 0.8)

        #expect(below.anchorPoint == UnitPoint(x: 0.3, y: 1))
        #expect(above.anchorPoint == UnitPoint(x: 0.8, y: 0))
    }

    @Test("anchorPoint centres a panel that has no tail to grow from")
    func anchorPointCentresWithoutATail() {
        // The bottom-bar fallback points at nothing, so it must not appear to
        // come from an edge `PanelShape` never drew. `resolveFallsBackWithoutRects`
        // pins that a geometry-less passage lands on this tail.
        #expect(PanelTail.none.anchorPoint == .center)
    }
}

@Suite("Selection payload")
struct SelectionPayloadTests {
    /// Exactly what `emitSelection` in `epub-reader-glue.js` posts.
    private let payload = """
    {
      "cfiRange": "epubcfi(/6/14!/4/2,/1:0,/1:24)",
      "text": "the Signora had no business",
      "rects": [
        { "x": 60, "y": 500, "width": 280, "height": 24 },
        { "x": 20, "y": 530, "width": 140, "height": 24 }
      ],
      "start": { "x": 60, "y": 500, "height": 24 },
      "end": { "x": 160, "y": 530, "height": 24 },
      "existing": null,
      "dragging": false
    }
    """

    @Test("selection decodes the geometry the glue reports")
    func selectionDecodesGlueGeometry() throws {
        let decoded = try JSONDecoder().decode(
            SelectionData.self, from: Data(payload.utf8)
        )

        #expect(decoded.cfiRange == "epubcfi(/6/14!/4/2,/1:0,/1:24)")
        #expect(decoded.text == "the Signora had no business")
        #expect(decoded.rects.count == 2)
        #expect(decoded.rects[0].cgRect == CGRect(x: 60, y: 500, width: 280, height: 24))
        #expect(decoded.start?.x == 60)
        #expect(decoded.end?.x == 160)
        #expect(decoded.existing == nil)
        #expect(decoded.dragging == false)
    }

    @Test("selection decodes an in-flight drag, which carries no CFI yet")
    func selectionDecodesDragWithoutCFI() throws {
        let dragging = """
        { "cfiRange": null, "text": "the Signora",
          "rects": [{ "x": 60, "y": 500, "width": 120, "height": 24 }],
          "start": null, "end": null, "existing": null, "dragging": true }
        """
        let decoded = try JSONDecoder().decode(
            SelectionData.self, from: Data(dragging.utf8)
        )

        #expect(decoded.cfiRange == nil)
        #expect(decoded.dragging)
    }

    @Test("selection decodes a settled range whose far end is on another page")
    func selectionDecodesRangeAcrossThePageBreak() throws {
        // The glue reports only the page in front of the reader: the start
        // caret is null because that end of the range is on the previous page.
        let acrossPages = """
        { "cfiRange": "epubcfi(/6/14!/4/2,/1:0,/5:12)", "text": "at all. She promised us",
          "rects": [{ "x": 20, "y": 90, "width": 200, "height": 24 }],
          "start": null, "end": { "x": 220, "y": 90, "height": 24 },
          "existing": null, "dragging": false }
        """
        let decoded = try JSONDecoder().decode(
            SelectionData.self, from: Data(acrossPages.utf8)
        )

        #expect(decoded.start == nil)
        #expect(decoded.end?.x == 220)
        #expect(decoded.rects.count == 1)
        #expect(!decoded.dragging)
    }

    @Test("annotationTap decodes the per-line rects of a tapped highlight")
    func annotationTapDecodesRects() throws {
        let tap = """
        { "cfiRange": "epubcfi(/6/14!/4/2,/1:0,/1:24)",
          "rects": [{ "x": 60, "y": 500, "width": 280, "height": 24 }] }
        """
        let decoded = try JSONDecoder().decode(
            AnnotationTapData.self, from: Data(tap.utf8)
        )

        #expect(decoded.rects.count == 1)
        #expect(decoded.rects[0].width == 280)
    }
}

@Suite("Drag haptics")
struct DragHapticTests {
    @Test("crossesWordBoundary ticks when a drag takes in another word")
    func crossesWordBoundaryWhenAWordIsTakenIn() {
        #expect(SelectionData.crossesWordBoundary(from: "the Signora", to: "the Signora had"))
        #expect(SelectionData.crossesWordBoundary(from: "the Signora had", to: "the Signora"))
        // A character drag reaches the next word one letter at a time; the
        // tick lands on the first letter, not on the space before it.
        #expect(SelectionData.crossesWordBoundary(from: "the Signora ", to: "the Signora h"))
    }

    @Test("crossesWordBoundary stays quiet while a drag moves inside a word")
    func crossesWordBoundaryIsQuietInsideAWord() {
        #expect(!SelectionData.crossesWordBoundary(from: "the Sig", to: "the Sign"))
        #expect(!SelectionData.crossesWordBoundary(from: "the Signora", to: "the Signora "))
        #expect(!SelectionData.crossesWordBoundary(from: "the Signora", to: "the Signora"))
    }
}

@Suite("Passage text")
struct PassageTextTests {
    @Test("collapsingWhitespace folds the source file's own line breaks away")
    func collapsingWhitespaceFoldsSourceBreaks() {
        let raw = "  “The Signora had\n        no business at\n  all. She promised us  "

        #expect(
            raw.collapsingWhitespace
                == "“The Signora had no business at all. She promised us"
        )
    }

    @Test("collapsingWhitespace leaves an already-clean passage alone")
    func collapsingWhitespaceLeavesCleanTextAlone() {
        let clean = "no business at all"

        #expect(clean.collapsingWhitespace == clean)
    }
}
