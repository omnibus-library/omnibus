//  PDFPositionTests.swift
//  The PDF page ↔ progress record mapping — the arithmetic every device
//  agrees on — and which reader a book's formats open.
//
//  These mirror the web PDF reader's tests for the same math: the anchor
//  round-trip, the percent's endpoint behaviour, and the resume fallback
//  chain. A divergence here is a book that resumes on a different page than
//  the one the other client saved.

import Foundation
import Testing

@testable import omnibus

@Suite("PDF page anchor")
struct PDFAnchorPositionTests {
    @Test("an anchor round-trips through its parser")
    func anchorRoundTrips() {
        #expect(PDFPosition.anchor(page: 0) == "pdf-page:0")
        #expect(PDFPosition.parseAnchor(PDFPosition.anchor(page: 12)) == 12)
    }

    @Test("a CFI, a comic anchor, or a highlight anchor is not misread as a page")
    func foreignPositionsAreRejected() {
        #expect(PDFPosition.parseAnchor("epubcfi(/6/4!/4/2)") == nil)
        #expect(PDFPosition.parseAnchor("comic-page:7") == nil)
        #expect(PDFPosition.parseAnchor("pdf:7") == nil)
        #expect(PDFPosition.parseAnchor("pdf-page:") == nil)
        #expect(PDFPosition.parseAnchor("pdf-page:12b") == nil)
        #expect(PDFPosition.parseAnchor("pdf-page:-1") == nil)
        #expect(PDFPosition.parseAnchor("") == nil)
    }
}

@Suite("PDF percent")
struct PDFPercentTests {
    @Test("first and last pages map to the ends of the bar")
    func endpointsMapToEnds() {
        #expect(PDFPosition.percent(page: 0, count: 219) == 0)
        #expect(PDFPosition.percent(page: 218, count: 219) == 100)
        #expect(PDFPosition.percent(page: 0, count: 1) == 100)
        #expect(PDFPosition.percent(page: 0, count: 0) == 0)
    }

    @Test("the midpoint rounds like the web reader's pdf_percent")
    func midpointMatchesTheWebMath() {
        #expect(PDFPosition.percent(page: 10, count: 20) == 55)
        #expect(PDFPosition.percent(page: 3, count: 8) == 50)
    }
}

@Suite("PDF resume page")
struct PDFStartPageTests {
    @Test("the exact anchor wins over the percent")
    func anchorWins() {
        #expect(PDFPosition.startPage(anchor: "pdf-page:41", percent: 10, count: 219) == 41)
    }

    @Test("an anchor past the end of a shrunken file is clamped")
    func anchorIsClamped() {
        #expect(PDFPosition.startPage(anchor: "pdf-page:999", percent: nil, count: 12) == 11)
    }

    @Test("the percent inverts when there is no usable anchor")
    func percentFallsBack() {
        let restored = PDFPosition.startPage(
            anchor: nil, percent: PDFPosition.percent(page: 107, count: 219), count: 219
        )
        #expect(abs(restored - 107) <= 1)
        #expect(PDFPosition.startPage(anchor: "epubcfi(/6/4)", percent: 50, count: 10) == 4)
        #expect(PDFPosition.startPage(anchor: nil, percent: 0, count: 10) == 0)
        #expect(PDFPosition.startPage(anchor: nil, percent: 100, count: 10) == 9)
    }

    @Test("a foreign anchor with no percent opens on page one")
    func foreignAnchorsAreIgnored() {
        #expect(PDFPosition.startPage(anchor: "comic-page:7", percent: nil, count: 20) == 0)
        #expect(PDFPosition.startPage(anchor: "pdf:7", percent: nil, count: 20) == 0)
        #expect(PDFPosition.startPage(anchor: nil, percent: nil, count: 20) == 0)
        #expect(PDFPosition.startPage(anchor: nil, percent: nil, count: 0) == 0)
    }
}

@Suite("Which reader a book opens")
struct PDFReaderRoutingTests {
    private func book(_ formats: [String]) -> Book {
        Book(id: 1, filename: "b.pdf", title: "B", uniqueIdentifier: "b", formats: formats)
    }

    @Test("a PDF-only book opens in the PDF reader")
    func pdfOnlyOpensAsPDF() {
        let b = book(["pdf"])
        #expect(b.hasPDF)
        #expect(b.opensAsPDF)
        #expect(!b.opensAsComic)
        #expect(b.hasEbook)
    }

    @Test("an EPUB or a CBZ keeps its own reader — the shared EPUB > CBZ > PDF ladder")
    func otherFormatsWin() {
        #expect(!book(["pdf", "epub"]).opensAsPDF)
        #expect(!book(["PDF", "cbz"]).opensAsPDF)
        #expect(book(["PDF", "cbz"]).opensAsComic)
        #expect(!book(["epub"]).opensAsPDF)
        #expect(!book([]).opensAsPDF)
        #expect(book(["m4b", "pdf"]).opensAsPDF)
    }

    @Test("a download plan names a PDF-only book's file by its extension")
    func downloadFallsBackToPDF() {
        #expect(DownloadManager.fallbackEbookExtension(book(["pdf"])) == "pdf")
        #expect(DownloadManager.fallbackEbookExtension(book(["cbz"])) == "cbz")
        #expect(DownloadManager.fallbackEbookExtension(book(["epub", "pdf"])) == "epub")
    }

    @Test("the download validator follows the same ladder as /file")
    func targetFileWalksTheLadder() {
        var b = book(["pdf", "epub"])
        b.bookFiles = [
            BookFileInfo(id: 1, format: "PDF", filename: "a.pdf", ordinal: 0, label: nil, path: nil, etag: "pdf-tag"),
            BookFileInfo(id: 2, format: "EPUB", filename: "a.epub", ordinal: 1, label: nil, path: nil, etag: "epub-tag"),
        ]
        #expect(DownloadManager.targetFile(b, kind: .ebook)?.etag == "epub-tag")
        b.bookFiles.removeFirst()
        b.bookFiles[0] = BookFileInfo(id: 1, format: "PDF", filename: "a.pdf", ordinal: 0, label: nil, path: nil, etag: "pdf-tag")
        #expect(DownloadManager.targetFile(b, kind: .ebook)?.etag == "pdf-tag")
    }
}
