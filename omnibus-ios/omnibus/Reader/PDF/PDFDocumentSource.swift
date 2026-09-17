//  PDFDocumentSource.swift
//  Where the PDF reader's bytes come from, and whether a fetched file is a
//  PDF at all.
//
//  A downloaded copy opens with no network in the path. Otherwise the whole
//  file is fetched from `/api/ebooks/{uuid}/file` into a cache file keyed on
//  the library file's validator and opened from disk — never from a `Data`,
//  which would hold a scanned book's every page in memory at once. PDFKit
//  pages the file on demand from a URL.

import Foundation
import PDFKit

/// The pure half of the resolution: which backing a book's PDF opens from,
/// given what the device holds and whether the server can be reached.
enum PDFBacking: Equatable {
    /// A finished download, or a cache file whose validator still matches.
    case local(URL)
    /// Fetch `/api/ebooks/{uuid}/file` into the cache, then open it.
    case remote(path: String)
    /// Nothing on the device and no server to ask.
    case unavailable
}

enum PDFDocumentSource {
    /// Decide the backing from what is known. `localURL` is the download
    /// manager's answer for the ebook kind; only a `.pdf` counts, because a
    /// mixed book's download is its EPUB, which is not what this reader
    /// opens. The cache is a refetch saver, not an offline surface: the
    /// download is the offline contract, and `Presentation.canOpen` stops an
    /// undownloaded book before this runs when the server is gone.
    static func backing(uuid: String, localURL: URL?, cachedURL: URL?, isOnline: Bool) -> PDFBacking {
        if let localURL, localURL.pathExtension.lowercased() == "pdf" {
            return .local(localURL)
        }
        if let cachedURL { return .local(cachedURL) }
        return isOnline ? .remote(path: "/api/ebooks/\(uuid)/file") : .unavailable
    }

    /// Where a streamed copy is cached. The validator rides the name so a
    /// replaced library file misses rather than serving the old edition;
    /// with no validator known there is no cache entry to trust.
    static func cacheURL(uuid: String, etag: String?) -> URL? {
        guard let etag, !etag.isEmpty else { return nil }
        let safe = etag.map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        return cacheDirectory.appendingPathComponent("\(uuid)-\(safe).pdf")
    }

    /// Where a fetch lands: the cache entry when the validator is known,
    /// else one fixed per-book file that the next open overwrites — never
    /// a fresh temporary per open, which left a whole PDF behind each time
    /// a validator-less book was read. Only [`cacheURL`] is ever read back,
    /// so the untracked file is never mistaken for a current copy.
    static func fetchDestination(uuid: String, etag: String?) -> URL {
        cacheURL(uuid: uuid, etag: etag)
            ?? cacheDirectory.appendingPathComponent("\(uuid)-untracked.pdf")
    }

    static var cacheDirectory: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("omnibus-pdf", isDirectory: true)
    }

    /// Open the book's PDF: the download when there is one, the cache when
    /// it is current, else a fetch. `nil` with a message the reader can show.
    @MainActor
    static func open(book: Book) async -> Result<PDFDocument, PDFOpenFailure> {
        let uuid = book.uuid
        // A rail card carries no file rows; the detail read has the validator
        // the cache is keyed on.
        var etag = DownloadManager.targetFile(book, kind: .ebook)?.etag
        if etag == nil, Connectivity.shared.isOnline,
           let detail = try? await LibraryService.settledBook(uuid: uuid)
        {
            etag = DownloadManager.targetFile(detail, kind: .ebook)?.etag
        }
        let cached = cacheURL(uuid: uuid, etag: etag).flatMap { url in
            FileManager.default.fileExists(atPath: url.path) ? url : nil
        }
        let backing = backing(
            uuid: uuid,
            localURL: DownloadManager.shared.localURL(for: uuid, kind: .ebook),
            cachedURL: cached,
            isOnline: Connectivity.shared.isOnline
        )
        switch backing {
        case let .local(url):
            if let document = PDFDocument(url: url) { return .success(document) }
            // A damaged download or cache must not dead-end the book while
            // the server can still serve it.
            try? FileManager.default.removeItem(at: url)
            guard Connectivity.shared.isOnline else { return .failure(.damaged) }
            return await fetch(path: "/api/ebooks/\(uuid)/file", uuid: uuid, etag: etag)
        case let .remote(path):
            return await fetch(path: path, uuid: uuid, etag: etag)
        case .unavailable:
            return .failure(.offline)
        }
    }

    /// Fetch the file to disk and open it. With no validator to key a cache
    /// entry on, the bytes land in a per-open temporary file instead.
    private static func fetch(path: String, uuid: String, etag: String?) async -> Result<PDFDocument, PDFOpenFailure> {
        guard let url = await APIClient.shared.absoluteURL(path) else { return .failure(.offline) }
        var request = URLRequest(url: url)
        for (header, value) in await APIClient.shared.authHeaders() {
            request.setValue(value, forHTTPHeaderField: header)
        }
        let destination = fetchDestination(uuid: uuid, etag: etag)
        do {
            let (staged, response) = try await URLSession.shared.download(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(status) else {
                try? FileManager.default.removeItem(at: staged)
                return .failure(.server(status))
            }
            try FileManager.default.createDirectory(
                at: destination.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: staged, to: destination)
        } catch {
            return .failure(.network(error.localizedDescription))
        }
        guard PDFIntegrity.verify(url: destination), let document = PDFDocument(url: destination) else {
            try? FileManager.default.removeItem(at: destination)
            return .failure(.damaged)
        }
        return .success(document)
    }
}

/// Why the reader has no document to show.
enum PDFOpenFailure: Equatable, Error {
    case offline
    case damaged
    case server(Int)
    case network(String)

    var message: String {
        switch self {
        case .offline:
            "This book isn't downloaded, and the server can't be reached."
        case .damaged:
            "This PDF couldn't be opened."
        case let .server(status):
            "The server answered \(status)."
        case let .network(detail):
            detail
        }
    }
}

/// The post-download backstop for a PDF: structural only. The format carries
/// no checksum, so this catches truncation and a body that isn't a PDF, and
/// nothing subtler — rule 09's PDF line.
enum PDFIntegrity {
    /// How much of the tail is searched for the end-of-file marker. The spec
    /// says "the last 1024 bytes"; readers in the wild look that far too.
    static let trailerWindow = 1024

    static func verify(url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        guard let size = try? handle.seekToEnd(), size > 0 else { return false }
        try? handle.seek(toOffset: 0)
        guard let head = try? handle.read(upToCount: 5), headerIsPDF(head) else { return false }
        let start = size > UInt64(trailerWindow) ? size - UInt64(trailerWindow) : 0
        try? handle.seek(toOffset: start)
        guard let tail = try? handle.readToEnd(), tailHasEOF(tail) else { return false }
        // The parse itself, so a file that is `%PDF-` … `%%EOF` around
        // garbage still fails — and a document with no pages is a broken
        // download, not an intact empty book.
        guard let document = PDFDocument(url: url), document.pageCount > 0 else { return false }
        return true
    }

    /// The five-byte magic every PDF opens with.
    static func headerIsPDF(_ bytes: Data) -> Bool {
        bytes.starts(with: Data("%PDF-".utf8))
    }

    /// Whether the end-of-file marker appears in these trailing bytes.
    static func tailHasEOF(_ bytes: Data) -> Bool {
        bytes.range(of: Data("%%EOF".utf8)) != nil
    }
}
