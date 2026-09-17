//  PDFDocumentSourceTests.swift
//  Where the PDF reader opens a book from, and the structural integrity
//  verdict a fetched file gets before it is installed or shown.

import Foundation
import PDFKit
import Testing

@testable import omnibus

@Suite("PDF backing")
struct PDFBackingTests {
    private let local = URL(fileURLWithPath: "/downloads/u.ebook.pdf")
    private let cached = URL(fileURLWithPath: "/caches/u-tag.pdf")

    @Test("a downloaded PDF opens locally, online or not")
    func downloadWins() {
        #expect(PDFDocumentSource.backing(uuid: "u", localURL: local, cachedURL: nil, isOnline: false) == .local(local))
        #expect(PDFDocumentSource.backing(uuid: "u", localURL: local, cachedURL: cached, isOnline: true) == .local(local))
    }

    @Test("a mixed book's EPUB download is not this reader's file")
    func epubDownloadIsIgnored() {
        let epub = URL(fileURLWithPath: "/downloads/u.ebook.epub")
        #expect(PDFDocumentSource.backing(uuid: "u", localURL: epub, cachedURL: nil, isOnline: true) == .remote(path: "/api/ebooks/u/file"))
        #expect(PDFDocumentSource.backing(uuid: "u", localURL: epub, cachedURL: nil, isOnline: false) == .unavailable)
    }

    @Test("a current cache entry is used before the network, and nothing at all offline")
    func cacheThenRemoteThenNothing() {
        #expect(PDFDocumentSource.backing(uuid: "u", localURL: nil, cachedURL: cached, isOnline: false) == .local(cached))
        #expect(PDFDocumentSource.backing(uuid: "u", localURL: nil, cachedURL: nil, isOnline: true) == .remote(path: "/api/ebooks/u/file"))
        #expect(PDFDocumentSource.backing(uuid: "u", localURL: nil, cachedURL: nil, isOnline: false) == .unavailable)
    }

    @Test("the cache is keyed on the validator, and absent without one")
    func cacheKeyCarriesTheValidator() {
        let url = PDFDocumentSource.cacheURL(uuid: "u", etag: "\"abc/123\"")
        #expect(url?.lastPathComponent == "u--abc-123-.pdf")
        #expect(url?.deletingLastPathComponent() == PDFDocumentSource.cacheDirectory)
        #expect(PDFDocumentSource.cacheURL(uuid: "u", etag: nil) == nil)
        #expect(PDFDocumentSource.cacheURL(uuid: "u", etag: "") == nil)
    }

    @Test("a fetch without a validator lands on one fixed file per book, never a fresh temporary")
    func untrackedFetchIsBounded() {
        let first = PDFDocumentSource.fetchDestination(uuid: "u", etag: nil)
        let second = PDFDocumentSource.fetchDestination(uuid: "u", etag: nil)
        #expect(first == second)
        #expect(first.lastPathComponent == "u-untracked.pdf")
        #expect(first.deletingLastPathComponent() == PDFDocumentSource.cacheDirectory)
        // …and it is never read back as a current copy.
        #expect(PDFDocumentSource.cacheURL(uuid: "u", etag: nil) == nil)
        #expect(PDFDocumentSource.fetchDestination(uuid: "u", etag: "t") == PDFDocumentSource.cacheURL(uuid: "u", etag: "t"))
    }

    @Test("every failure has a sentence the reader can act on")
    func failuresHaveMessages() {
        for failure in [PDFOpenFailure.offline, .damaged, .server(503), .network("timed out")] {
            #expect(!failure.message.isEmpty)
        }
        #expect(PDFOpenFailure.server(503).message.contains("503"))
    }
}

@Suite("PDF integrity")
struct PDFIntegrityTests {
    private var intact: Data { TestPDF(pages: ["A page"]).build() }

    private func write(_ bytes: Data) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).pdf")
        try bytes.write(to: url)
        return url
    }

    @Test("an intact PDF passes")
    func intactPasses() throws {
        #expect(PDFIntegrity.verify(url: try write(intact)))
    }

    @Test("a truncated transfer fails on the missing end-of-file marker")
    func truncatedFails() throws {
        let cut = intact.prefix(intact.count - 12)
        #expect(!PDFIntegrity.tailHasEOF(Data(cut.suffix(PDFIntegrity.trailerWindow))))
        #expect(!PDFIntegrity.verify(url: try write(Data(cut))))
    }

    @Test("a body that is not a PDF fails on the header")
    func nonPDFFails() throws {
        let html = Data("<html><body>Sign in</body></html>\n%%EOF".utf8)
        #expect(!PDFIntegrity.headerIsPDF(html))
        #expect(!PDFIntegrity.verify(url: try write(html)))
        #expect(!PDFIntegrity.verify(url: try write(Data())))
    }

    @Test("the right header and trailer around garbage still fail the parse")
    func garbageBetweenTheMarkersFails() throws {
        let fake = Data("%PDF-1.4\nthis is not a document\n%%EOF\n".utf8)
        #expect(PDFIntegrity.headerIsPDF(fake))
        #expect(PDFIntegrity.tailHasEOF(fake))
        #expect(!PDFIntegrity.verify(url: try write(fake)))
    }

    @Test("a missing file is not intact")
    func missingFileFails() {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("nope-\(UUID().uuidString).pdf")
        #expect(!PDFIntegrity.verify(url: missing))
    }
}
