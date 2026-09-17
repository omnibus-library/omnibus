//  PDFHighlightPainter.swift
//  Between PDFKit's geometry and the shared anchor: a selection becomes the
//  quads its anchor stores, a stored highlight becomes the annotation
//  PDFKit draws, and a tap on that annotation finds its row again.
//
//  Everything here is in PDF user space on the unrotated page — the frame
//  `PDFSelection.bounds(for:)` and `PDFAnnotation.bounds` share, and the one
//  the anchor is defined in — so a `/Rotate 90` page produces the same anchor
//  as its upright twin. The view-space conversion for the menu happens at the
//  stage, which is the only thing that knows where the page is on screen.

import PDFKit
import SwiftUI
import UIKit

/// A settled selection, reduced to what the anchor and the menu need.
struct PDFSelectionData: Equatable {
    var page: Int
    var quads: [PDFQuad]
    var text: String
    /// One rect per selected line, in the stage view's coordinates, for the
    /// menu to hang off.
    var rects: [PageRect] = []

    /// The anchor this selection stores — the whole-quads form, degrading to
    /// the page alone past the cap the way the codec does.
    var anchor: String { PDFAnchor(page: page, quads: quads).encode() }
}

enum PDFHighlightPainter {
    /// The PDF `/F` flag bits ReadOnly (7) and Locked (8) — iOS has no typed
    /// `flags` accessor, so the raw dictionary value is set.
    static let lockedFlags = (1 << 6) | (1 << 7)

    /// The annotation-side name every painted highlight carries, so a tap
    /// can be traced back to its row. PDFKit persists `userName` as the
    /// annotation's `/T`, which is never written back to the file here.
    static let namePrefix = "omnibus-highlight:"

    /// One quad per selected line on `page`, in page user space. Lines on
    /// any other page are dropped — the reader is single-page, like the web
    /// one, so an anchor names exactly one page.
    static func quads(of selection: PDFSelection, on page: PDFPage) -> [PDFQuad] {
        selection.selectionsByLine().compactMap { line in
            guard line.pages.contains(page) else { return nil }
            let bounds = line.bounds(for: page)
            guard bounds.width > 0, bounds.height > 0 else { return nil }
            return PDFQuad(rect: bounds)
        }
    }

    /// The settled selection on `page`, or `nil` when nothing on it is
    /// selected. `rects` come back empty; the stage fills them in.
    static func selectionData(_ selection: PDFSelection, on page: PDFPage, index: Int) -> PDFSelectionData? {
        let quads = quads(of: selection, on: page)
        guard !quads.isEmpty else { return nil }
        let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !text.isEmpty else { return nil }
        return PDFSelectionData(page: index, quads: quads, text: text)
    }

    /// The annotation that paints one stored highlight, or `nil` for an
    /// anchor this document cannot place — a CFI from a mixed book's EPUB, an
    /// anchorless Kobo row, a page past the end, or the page-only degraded
    /// form, which lists and jumps but has nothing to paint.
    static func annotation(for highlight: Highlight, in document: PDFDocument) -> (PDFPage, PDFAnnotation)? {
        guard let anchorText = highlight.epubCFIRange,
              let anchor = PDFAnchor.parse(anchorText),
              !anchor.quads.isEmpty,
              anchor.page < document.pageCount,
              let page = document.page(at: anchor.page)
        else { return nil }
        let annotation = makeAnnotation(quads: anchor.quads, color: highlight.color)
        annotation.userName = namePrefix + highlight.pathID
        return (page, annotation)
    }

    /// A highlight annotation over `quads`. PDFKit takes its quadrilateral
    /// points relative to the annotation's bounds origin, so the union rect
    /// is the bounds and every corner is shifted into it.
    static func makeAnnotation(quads: [PDFQuad], color: HighlightColor) -> PDFAnnotation {
        let bounds = quads.map(\.boundingRect).reduce(CGRect.null) { $0.union($1) }
        let annotation = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
        annotation.quadrilateralPoints = quads.flatMap { quad in
            quad.points.map { point in
                NSValue(cgPoint: CGPoint(x: point.x - bounds.minX, y: point.y - bounds.minY))
            }
        }
        annotation.color = UIColor(color.tint)
        // Locked and read-only: PDFKit offers its own Remove / Add Note over
        // an editable markup annotation, which would take the mark off the
        // page without touching the row. The app's menu is the only editor.
        annotation.setValue(NSNumber(value: lockedFlags), forAnnotationKey: .flags)
        return annotation
    }

    /// The row a painted annotation belongs to, by the name it was given.
    static func highlight(for annotation: PDFAnnotation, in highlights: [Highlight]) -> Highlight? {
        guard let name = annotation.userName, name.hasPrefix(namePrefix) else { return nil }
        let pathID = String(name.dropFirst(namePrefix.count))
        return highlights.first { $0.pathID == pathID }
    }

    /// Whether an annotation is one of ours — what the repaint removes and
    /// the tap hit-tests — as opposed to one the file itself carries.
    static func isPainted(_ annotation: PDFAnnotation) -> Bool {
        annotation.userName?.hasPrefix(namePrefix) == true
    }
}

/// One row of the flattened outline: what the contents sheet lists.
struct PDFOutlineItem: Equatable, Identifiable {
    var id: Int
    var label: String
    var level: Int
    /// 0-based page, or `nil` for an entry with no resolvable destination.
    var page: Int?
}

extension PDFOutlineItem {
    /// The document's outline as a flat list in document order, nesting
    /// carried as `level`. A PDF built without an outline lists nothing.
    static func flatten(_ document: PDFDocument) -> [PDFOutlineItem] {
        guard let root = document.outlineRoot else { return [] }
        var items: [PDFOutlineItem] = []
        func walk(_ node: PDFOutline, level: Int) {
            for index in 0..<node.numberOfChildren {
                guard let child = node.child(at: index) else { continue }
                let label = child.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let page = child.destination?.page.map { document.index(for: $0) }
                if !label.isEmpty {
                    items.append(PDFOutlineItem(id: items.count, label: label, level: level, page: page))
                }
                walk(child, level: level + 1)
            }
        }
        walk(root, level: 0)
        return items
    }
}
