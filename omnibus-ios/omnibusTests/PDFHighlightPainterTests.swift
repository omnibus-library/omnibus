//  PDFHighlightPainterTests.swift
//  PDFKit geometry ↔ the shared anchor, on a synthesized document: the quads
//  a selection produces, that a rotated page produces the same ones, the
//  annotation a stored highlight paints, the tap that finds it again, and
//  the outline the contents sheet lists.

import CoreGraphics
import Foundation
import PDFKit
import SwiftUI
import Testing

@testable import omnibus

private let prose = "Hello highlight world\nSecond line of text"

private func document(rotate: Int? = nil, outline: [(title: String, page: Int)] = []) throws -> PDFDocument {
    var spec = TestPDF(pages: [prose, "Page two"])
    spec.rotate = rotate
    spec.outline = outline
    let doc = try #require(PDFDocument(data: spec.build()))
    return doc
}

private func selectFirstWord(in doc: PDFDocument) throws -> (PDFPage, PDFSelection) {
    let page = try #require(doc.page(at: 0))
    // "Hello" — the first five characters of the page's text.
    let selection = try #require(page.selection(for: NSRange(location: 0, length: 5)))
    return (page, selection)
}

private func highlight(_ anchor: String?, color: HighlightColor = .amber, id: Int64 = 7) -> Highlight {
    Highlight(
        id: id, bookUUID: "book-a", epubCFIRange: anchor, color: color, note: nil,
        text: "Hello", clientID: "client-\(id)", createdAt: 0
    )
}

@Suite("PDF selection → quads")
struct PDFSelectionQuadTests {
    @Test("a one-line selection is one quad in user space, y up")
    func oneLineIsOneQuad() throws {
        let doc = try document()
        let (page, selection) = try selectFirstWord(in: doc)
        let data = try #require(PDFHighlightPainter.selectionData(selection, on: page, index: 0))
        #expect(data.page == 0)
        #expect(data.text == "Hello")
        #expect(data.quads.count == 1)
        let q = try #require(data.quads.first)
        // The text is set at x=72 on a 792pt page, 720 up from the bottom.
        #expect(q.lowerLeft.x >= 71 && q.lowerLeft.x <= 73)
        #expect(q.lowerLeft.y > 700 && q.lowerLeft.y < 725)
        #expect(q.upperLeft.y > q.lowerLeft.y)
        #expect(q.upperRight.x > q.upperLeft.x)
        #expect(data.anchor.hasPrefix("pdf:0:"))
        // The anchor carries a tenth of a point; what parses back is the
        // selection's geometry to that precision.
        let parsed = try #require(PDFAnchor.parse(data.anchor))
        #expect(parsed.quads.count == 1)
        for (stored, live) in zip(parsed.quads[0].points, q.points) {
            #expect(abs(stored.x - live.x) <= 0.05)
            #expect(abs(stored.y - live.y) <= 0.05)
        }
    }

    @Test("a /Rotate 90 page encodes the same anchor as its upright twin")
    func rotationDoesNotMoveTheAnchor() throws {
        // The anchor is defined in unrotated user space — the frame PDF.js's
        // rotation-0 viewport also reports — so the page's /Rotate must not
        // leak into it, or a highlight made here would paint sideways on web.
        let upright = try document()
        let rotated = try document(rotate: 90)
        let (p0, s0) = try selectFirstWord(in: upright)
        let (p1, s1) = try selectFirstWord(in: rotated)
        let a0 = try #require(PDFHighlightPainter.selectionData(s0, on: p0, index: 0)).anchor
        let a1 = try #require(PDFHighlightPainter.selectionData(s1, on: p1, index: 0)).anchor
        #expect(a0 == a1)
        #expect(p1.rotation == 90)
    }

    @Test("a selection spanning lines gives one quad per line")
    func multiLineGivesOneQuadPerLine() throws {
        let doc = try document()
        let page = try #require(doc.page(at: 0))
        let text = try #require(page.string)
        let selection = try #require(page.selection(for: NSRange(location: 0, length: text.count)))
        let quads = PDFHighlightPainter.quads(of: selection, on: page)
        #expect(quads.count == 2)
        // Lines stack downward on the page, which is a smaller y in user space.
        #expect(quads[0].lowerLeft.y > quads[1].lowerLeft.y)
    }

    @Test("lines on another page are left out")
    func otherPagesAreDropped() throws {
        let doc = try document()
        let page0 = try #require(doc.page(at: 0))
        let page1 = try #require(doc.page(at: 1))
        let selection = try #require(page0.selection(for: NSRange(location: 0, length: 5)))
        #expect(PDFHighlightPainter.quads(of: selection, on: page1).isEmpty)
        #expect(PDFHighlightPainter.selectionData(selection, on: page1, index: 1) == nil)
    }
}

@Suite("PDF highlight painting")
struct PDFHighlightPaintTests {
    @Test("a stored anchor paints a highlight annotation on its page, named for its row")
    func paintsAStoredHighlight() throws {
        let doc = try document()
        let anchor = "pdf:1:72.0,730.0,172.0,730.0,72.0,720.0,172.0,720.0"
        let (page, annotation) = try #require(
            PDFHighlightPainter.annotation(for: highlight(anchor, color: .green), in: doc)
        )
        #expect(doc.index(for: page) == 1)
        #expect(annotation.type == "Highlight")
        #expect(annotation.bounds == CGRect(x: 72, y: 720, width: 100, height: 10))
        #expect(annotation.quadrilateralPoints?.count == 4)
        #expect(annotation.userName == "omnibus-highlight:client-7")
        #expect(PDFHighlightPainter.isPainted(annotation))
        // Points are relative to the bounds origin — PDFKit's convention.
        let first = try #require(annotation.quadrilateralPoints?.first as? NSValue).cgPointValue
        #expect(first == CGPoint(x: 0, y: 10))
    }

    @Test("two quads share one annotation whose bounds cover both")
    func unionsTheQuads() throws {
        let doc = try document()
        let anchor = "pdf:0:72,730,172,730,72,720,172,720;72,716,272,716,72,706,272,706"
        let (_, annotation) = try #require(PDFHighlightPainter.annotation(for: highlight(anchor), in: doc))
        #expect(annotation.bounds == CGRect(x: 72, y: 706, width: 200, height: 24))
        #expect(annotation.quadrilateralPoints?.count == 8)
    }

    @Test("an anchor the document cannot place paints nothing")
    func unplaceableAnchorsPaintNothing() throws {
        let doc = try document()
        #expect(PDFHighlightPainter.annotation(for: highlight(nil), in: doc) == nil)
        #expect(PDFHighlightPainter.annotation(for: highlight("epubcfi(/6/4!/4/2,/1:0,/1:4)"), in: doc) == nil)
        #expect(PDFHighlightPainter.annotation(for: highlight("pdf-page:0"), in: doc) == nil)
        // Page-only (degraded) lists and jumps, but has no rectangle.
        #expect(PDFHighlightPainter.annotation(for: highlight("pdf:0"), in: doc) == nil)
        // Past the end of a two-page document.
        #expect(PDFHighlightPainter.annotation(for: highlight("pdf:5:0,0,1,0,0,1,1,1"), in: doc) == nil)
    }

    @Test("a tap on a painted annotation finds its row, and a file's own annotation finds none")
    func tapTracesBackToTheRow() throws {
        let doc = try document()
        let rows = [highlight("pdf:0:72,730,172,730,72,720,172,720", id: 3), highlight("pdf:0", id: 4)]
        let (page, annotation) = try #require(PDFHighlightPainter.annotation(for: rows[0], in: doc))
        page.addAnnotation(annotation)
        let hit = try #require(page.annotation(at: CGPoint(x: 100, y: 725)))
        #expect(PDFHighlightPainter.highlight(for: hit, in: rows)?.id == 3)

        let foreign = PDFAnnotation(bounds: CGRect(x: 0, y: 0, width: 10, height: 10), forType: .square, withProperties: nil)
        #expect(!PDFHighlightPainter.isPainted(foreign))
        #expect(PDFHighlightPainter.highlight(for: foreign, in: rows) == nil)
    }

    @Test("the annotation takes the highlight's tint")
    func annotationCarriesTheColor() {
        let annotation = PDFHighlightPainter.makeAnnotation(
            quads: [PDFQuad(rect: CGRect(x: 0, y: 0, width: 10, height: 10))], color: .rose
        )
        #expect(annotation.color == UIColor(HighlightColor.rose.tint))
    }
}

@Suite("PDF outline")
struct PDFOutlineTests {
    @Test("the outline flattens to labelled rows with 0-based pages")
    func flattensTheOutline() throws {
        let doc = try document(outline: [("Opening", 0), ("Closing", 1)])
        let items = PDFOutlineItem.flatten(doc)
        #expect(items.map(\.label) == ["Opening", "Closing"])
        #expect(items.map(\.page) == [0, 1])
        #expect(items.allSatisfy { $0.level == 0 })
    }

    @Test("a document without an outline lists nothing")
    func noOutlineIsEmpty() throws {
        #expect(PDFOutlineItem.flatten(try document()).isEmpty)
    }
}
