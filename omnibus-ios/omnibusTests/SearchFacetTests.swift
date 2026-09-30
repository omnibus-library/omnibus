//  SearchFacetTests.swift
//  Opening a tag or genre asks for the books filed under it: the facet query's
//  spelling, its trip through the URL, and the mirror's exact-name match.

import Foundation
import SQLite3
import Testing

@testable import omnibus

// MARK: - Query spelling

struct SearchFacetQueryTests {
    @Test("a single-word name goes out bare, like the web's facet_query")
    func singleWordIsBare() {
        #expect(SearchFacet.tag.query("Unicorns") == "tag:Unicorns")
        #expect(SearchFacet.genre.query("Horror") == "genre:Horror")
    }

    @Test("a name with a space is quoted, so it stays one facet")
    func spacedNameIsQuoted() {
        #expect(SearchFacet.tag.query("Science Fiction") == "tag:\"Science Fiction\"")
        #expect(
            SearchFacet.tag.query("Science Fiction & Fantasy")
                == "tag:\"Science Fiction & Fantasy\""
        )
    }

    @Test("an embedded quote is doubled rather than ending the run")
    func embeddedQuoteIsEscaped() {
        #expect(
            SearchFacet.tag.query("the \"good\" parts") == "tag:\"the \"\"good\"\" parts\""
        )
    }

    @Test("surrounding whitespace is trimmed and an empty name asks nothing")
    func whitespaceIsTrimmed() {
        #expect(SearchFacet.genre.query("  Horror  ") == "genre:Horror")
        #expect(SearchFacet.tag.query("   ").isEmpty)
    }
}

// MARK: - URL encoding

struct RequestURLTests {
    /// Decode a query value the way the server's form decoder does: `+` is a
    /// space, then percent-escapes.
    private func formDecodedQ(_ url: URL) -> String? {
        let pair = url.query(percentEncoded: true)?
            .split(separator: "&")
            .first { $0.hasPrefix("q=") }
        return pair.map { String($0.dropFirst(2)) }?
            .replacingOccurrences(of: "+", with: " ")
            .removingPercentEncoding
    }

    @Test("a facet with spaces, an ampersand and quotes arrives intact")
    func ampersandAndSpacesSurvive() throws {
        let q = SearchFacet.tag.query("Science Fiction & Fantasy")
        let url = try #require(
            APIClient.requestURL(base: "http://host", path: "/api/search", query: ["q": q])
        )
        #expect(formDecodedQ(url) == q)
    }

    @Test("a plus is escaped, so the server doesn't read it as a space")
    func plusIsEscaped() throws {
        let q = SearchFacet.tag.query("C++")
        let url = try #require(
            APIClient.requestURL(base: "http://host", path: "/api/search", query: ["q": q])
        )
        #expect(formDecodedQ(url) == "tag:C++")
    }

    @Test("a nil value is omitted and no query leaves the path bare")
    func nilValuesAreOmitted() throws {
        let url = try #require(
            APIClient.requestURL(base: "http://host", path: "/api/tags", query: ["q": nil])
        )
        #expect(url.absoluteString == "http://host/api/tags")
    }
}

// MARK: - Mirror membership, run against a scratch SQLite table

/// Titles of the rows `LibraryIndex.facetClause` admits for `name`.
private func facetMatches(_ facet: SearchFacet, _ name: String, books: [Book]) throws -> Set<String> {
    var db: OpaquePointer?
    #expect(sqlite3_open(":memory:", &db) == SQLITE_OK)
    defer { sqlite3_close(db) }
    sqlite3_exec(db, "CREATE TABLE books (title TEXT NOT NULL, payload BLOB NOT NULL)", nil, nil, nil)
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for book in books {
        let payload = try JSONEncoder().encode(book)
        var insert: OpaquePointer?
        sqlite3_prepare_v2(db, "INSERT INTO books (title, payload) VALUES (?, ?)", -1, &insert, nil)
        sqlite3_bind_text(insert, 1, book.displayTitle, -1, transient)
        _ = payload.withUnsafeBytes {
            sqlite3_bind_blob(insert, 2, $0.baseAddress, Int32(payload.count), transient)
        }
        sqlite3_step(insert)
        sqlite3_finalize(insert)
    }

    let sql = "SELECT title FROM books WHERE \(LibraryIndex.facetClause(facet))"
    var stmt: OpaquePointer?
    #expect(sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK)
    defer { sqlite3_finalize(stmt) }
    sqlite3_bind_text(stmt, 1, name, -1, transient)
    var out: Set<String> = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        out.insert(String(cString: sqlite3_column_text(stmt, 0)))
    }
    return out
}

struct MirrorFacetTests {
    private let books: [Book] = {
        var tagged = Book(id: 1, filename: "a.epub", title: "Dune", uniqueIdentifier: "a")
        tagged.subjects = ["Science Fiction & Fantasy", "Unicorns"]
        tagged.genres = ["Contemporary Fiction"]
        // Its title holds the tag's words — the free-text search's false hit.
        let titled = Book(
            id: 2, filename: "b.epub", title: "Science Fiction & Fantasy Stories",
            uniqueIdentifier: "b"
        )
        return [tagged, titled]
    }()

    @Test("a tag matches the books filed under it, not titles that contain its words")
    func tagMatchesMembershipNotTitle() throws {
        #expect(try facetMatches(.tag, "Science Fiction & Fantasy", books: books) == ["Dune"])
    }

    @Test("the match is on the whole name, case-insensitively, like the server's")
    func tagMatchIsWholeNameCaseInsensitive() throws {
        #expect(try facetMatches(.tag, "unicorns", books: books) == ["Dune"])
        #expect(try facetMatches(.tag, "Science", books: books).isEmpty)
    }

    @Test("a genre reads the genres list, not the subjects")
    func genreReadsGenres() throws {
        #expect(try facetMatches(.genre, "contemporary fiction", books: books) == ["Dune"])
        #expect(try facetMatches(.genre, "Unicorns", books: books).isEmpty)
    }
}
