//  PDFAnchorTests.swift
//  The `pdf:{page}:{quads}` highlight anchor codec, pinned against the
//  shared Rust codec's own test vectors so a passage saved on either client
//  paints on the other.

import CoreGraphics
import Foundation
import Testing

@testable import omnibus

private func quad(_ x: CGFloat, _ y: CGFloat) -> PDFQuad {
    PDFQuad(rect: CGRect(x: x, y: y, width: 100, height: 10))
}

@Suite("PDF highlight anchor")
struct PDFAnchorTests {
    @Test("encodes with one decimal and parses back — the shared codec's vector")
    func encodesLikeTheSharedCodec() {
        // `omnibus_shared::pdf_anchor`'s own test: two quads, one decimal each.
        let anchor = PDFAnchor(page: 2, quads: [quad(72, 700.2), quad(72, 686.0)])
        let encoded = anchor.encode()
        #expect(
            encoded
                == "pdf:2:72.0,710.2,172.0,710.2,72.0,700.2,172.0,700.2;"
                + "72.0,696.0,172.0,696.0,72.0,686.0,172.0,686.0"
        )
        let parsed = PDFAnchor.parse(encoded)
        #expect(parsed?.page == 2)
        #expect(parsed?.quads.count == 2)
        #expect(parsed?.quads[0].lowerLeft == CGPoint(x: 72, y: 700.2))
    }

    @Test("rounds ties upward, the way the web glue's Math.round does")
    func roundsLikeTheWebGlue() {
        // The web reader rounds each coordinate with `Math.round(n * 10) / 10`
        // before the shared codec formats it, so 710.25 is stored as 710.3
        // there — a bare `%.1f` (banker's on an exact tie) would write 710.2
        // here and the same selection would encode differently per client.
        #expect(PDFAnchor.format(710.25) == "710.3")
        #expect(PDFAnchor.format(0.05) == "0.1")
        #expect(PDFAnchor.format(-2.55) == "-2.5")
        #expect(PDFAnchor.format(72) == "72.0")
        #expect(PDFAnchor.format(700.04) == "700.0")
    }

    @Test("degrades to the page alone past the quad cap")
    func degradesPastTheCap() {
        let many = (0...PDFAnchor.maxQuads).map { quad(0, CGFloat($0)) }
        #expect(PDFAnchor(page: 4, quads: many).encode() == "pdf:4")
        #expect(PDFAnchor(page: 4, quads: []).encode() == "pdf:4")
        let parsed = PDFAnchor.parse("pdf:4")
        #expect(parsed?.page == 4)
        #expect(parsed?.quads.isEmpty == true)
        // Exactly at the cap still carries its quads.
        let atCap = PDFAnchor(page: 1, quads: Array(many.prefix(PDFAnchor.maxQuads)))
        #expect(PDFAnchor.parse(atCap.encode())?.quads.count == PDFAnchor.maxQuads)
    }

    @Test("rejects malformed and foreign input rather than painting a guess")
    func rejectsMalformedInput() {
        #expect(PDFAnchor.parse("pdf-page:4") == nil)
        #expect(PDFAnchor.parse("epubcfi(/6/4)") == nil)
        #expect(PDFAnchor.parse("comic-page:4") == nil)
        #expect(PDFAnchor.parse("pdf:x") == nil)
        #expect(PDFAnchor.parse("pdf:-1") == nil)
        #expect(PDFAnchor.parse("pdf:1:1,2,3") == nil)
        #expect(PDFAnchor.parse("pdf:1:1,2,3,4,5,6,7,NaN") == nil)
        #expect(PDFAnchor.parse("pdf:1:1,2,3,4,5,6,7,8;") == nil)
    }

    @Test("a web-written anchor parses to the quads it names")
    func parsesAWebAnchor() {
        let parsed = PDFAnchor.parse("pdf:9:0,0,1,0,0,1,1,1")
        #expect(parsed?.page == 9)
        #expect(parsed?.quads == [
            PDFQuad(
                upperLeft: .zero, upperRight: CGPoint(x: 1, y: 0),
                lowerLeft: CGPoint(x: 0, y: 1), lowerRight: CGPoint(x: 1, y: 1)
            ),
        ])
    }

    @Test("the page reads from either anchor form")
    func pageReadsBothForms() {
        #expect(PDFAnchor.page(of: "pdf-page:9") == 9)
        #expect(PDFAnchor.page(of: "pdf:9") == 9)
        #expect(PDFAnchor.page(of: "pdf:9:0,0,1,0,0,1,1,1") == 9)
        #expect(PDFAnchor.page(of: "comic-page:9") == nil)
        #expect(PDFAnchor.page(of: "epubcfi(/6/4)") == nil)
    }

    @Test("a quad's bounding rect is the union of its corners")
    func boundingRectCoversTheCorners() {
        let q = PDFQuad(rect: CGRect(x: 10, y: 20, width: 30, height: 5))
        #expect(q.boundingRect == CGRect(x: 10, y: 20, width: 30, height: 5))
        #expect(q.upperLeft == CGPoint(x: 10, y: 25))
        #expect(q.lowerRight == CGPoint(x: 40, y: 20))
    }
}
