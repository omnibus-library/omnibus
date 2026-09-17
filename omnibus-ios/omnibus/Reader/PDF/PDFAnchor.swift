//  PDFAnchor.swift
//  The `pdf:{page}:{quads}` highlight anchor — where on a PDF page a saved
//  passage sits.
//
//  Mirror of `omnibus_shared::pdf_anchor::PdfAnchor`. Quads are in PDF
//  user-space points on the *unrotated* page, origin bottom-left — the frame
//  PDFKit's `PDFSelection.bounds(for:)` reports and PDF.js's rotation-0
//  viewport speaks — so an anchor written here paints identically on the web
//  reader, and one written there paints here. Corner order is the PDF
//  `QuadPoints` convention: upper-left, upper-right, lower-left, lower-right.

import CoreGraphics
import Foundation

/// One quadrilateral of a highlight.
struct PDFQuad: Equatable, Sendable {
    var upperLeft: CGPoint
    var upperRight: CGPoint
    var lowerLeft: CGPoint
    var lowerRight: CGPoint

    /// The four corners in `QuadPoints` order.
    var points: [CGPoint] { [upperLeft, upperRight, lowerLeft, lowerRight] }

    /// The axis-aligned quad covering `rect` (user space, y up).
    init(rect: CGRect) {
        upperLeft = CGPoint(x: rect.minX, y: rect.maxY)
        upperRight = CGPoint(x: rect.maxX, y: rect.maxY)
        lowerLeft = CGPoint(x: rect.minX, y: rect.minY)
        lowerRight = CGPoint(x: rect.maxX, y: rect.minY)
    }

    init(upperLeft: CGPoint, upperRight: CGPoint, lowerLeft: CGPoint, lowerRight: CGPoint) {
        self.upperLeft = upperLeft
        self.upperRight = upperRight
        self.lowerLeft = lowerLeft
        self.lowerRight = lowerRight
    }

    /// The smallest rect containing every corner — what PDFKit's annotation
    /// bounds and the web painter's div both come from.
    var boundingRect: CGRect {
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max()
        else { return .zero }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

/// A highlight's anchor: the page it lives on and the quads it covers. Empty
/// `quads` is the degraded page-only form.
struct PDFAnchor: Equatable, Sendable {
    static let prefix = "pdf:"
    /// Most quads one anchor carries — past this it degrades to the page
    /// alone so it stays well under the server's anchor length cap. The
    /// highlight still lists and jumps; it just is not painted. Mirrors
    /// `PDF_ANCHOR_MAX_QUADS`.
    static let maxQuads = 60

    var page: Int
    var quads: [PDFQuad]

    /// Encode as `pdf:{page}:{x1,y1,…,x4,y4};{…}`, one decimal per number.
    ///
    /// The rounding is the web glue's `Math.round(n * 10) / 10` — half toward
    /// positive infinity, not the banker's rounding a bare `%.1f` applies to
    /// an exact tie — so the same coordinates encode to the same bytes on
    /// both clients. Sub-tenth-point differences are below any renderer's
    /// hit-test resolution.
    func encode() -> String {
        if quads.isEmpty || quads.count > Self.maxQuads {
            return "\(Self.prefix)\(page)"
        }
        let encoded = quads.map { quad in
            quad.points
                .flatMap { [$0.x, $0.y] }
                .map(Self.format)
                .joined(separator: ",")
        }
        return "\(Self.prefix)\(page):\(encoded.joined(separator: ";"))"
    }

    /// One coordinate as the anchor spells it.
    static func format(_ value: CGFloat) -> String {
        String(format: "%.1f", roundToTenth(Double(value)))
    }

    /// `Math.round(n * 10) / 10` — ties go up, whatever the sign, which is
    /// what JavaScript does and what the stored anchors were written with.
    static func roundToTenth(_ value: Double) -> Double {
        (value * 10 + 0.5).rounded(.down) / 10
    }

    /// Parse an [`encode()`]d anchor. `nil` for a foreign anchor (a CFI, a
    /// `pdf-page:` position) or a malformed quad list, so the reader never
    /// paints a rectangle it cannot place.
    static func parse(_ anchor: String) -> PDFAnchor? {
        guard anchor.hasPrefix(prefix) else { return nil }
        let rest = anchor.dropFirst(prefix.count)
        let pageText: Substring
        let quadText: Substring?
        if let colon = rest.firstIndex(of: ":") {
            pageText = rest[..<colon]
            quadText = rest[rest.index(after: colon)...]
        } else {
            pageText = rest
            quadText = nil
        }
        guard let page = Int(pageText), page >= 0 else { return nil }
        guard let quadText, !quadText.isEmpty else {
            return PDFAnchor(page: page, quads: [])
        }
        var quads: [PDFQuad] = []
        for chunk in quadText.split(separator: ";", omittingEmptySubsequences: false) {
            let numbers = chunk.split(separator: ",", omittingEmptySubsequences: false)
                .map { Double($0.trimmingCharacters(in: .whitespaces)) }
            guard numbers.count == 8 else { return nil }
            var values: [CGFloat] = []
            for number in numbers {
                guard let number, number.isFinite else { return nil }
                values.append(CGFloat(number))
            }
            quads.append(
                PDFQuad(
                    upperLeft: CGPoint(x: values[0], y: values[1]),
                    upperRight: CGPoint(x: values[2], y: values[3]),
                    lowerLeft: CGPoint(x: values[4], y: values[5]),
                    lowerRight: CGPoint(x: values[6], y: values[7])
                )
            )
        }
        guard quads.count <= maxQuads else { return nil }
        return PDFAnchor(page: page, quads: quads)
    }

    /// The 0-based page named by either PDF anchor form — a `pdf-page:N`
    /// position or a `pdf:` highlight — for callers that place both on the
    /// page ruler. Mirrors `pdf_anchor_page`.
    static func page(of anchor: String) -> Int? {
        PDFPosition.parseAnchor(anchor) ?? parse(anchor)?.page
    }
}
