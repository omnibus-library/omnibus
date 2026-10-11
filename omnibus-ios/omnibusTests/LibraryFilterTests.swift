//  LibraryFilterTests.swift
//  The library filter's clauses (#2643): their wire shape, how they reach the
//  server and key the caches, and where they are kept between launches.

import Foundation
import Testing

@testable import omnibus

/// A throwaway suite so the tests never touch the host's real defaults.
private func scratchDefaults() -> UserDefaults {
    let name = "omnibus.tests.libraryFilter.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

/// A query value decoded the way the server's form decoder reads it: `+` is a
/// space, then percent-escapes.
private func formDecoded(_ url: URL, _ name: String) -> String? {
    let pair = url.query(percentEncoded: true)?
        .split(separator: "&")
        .first { $0.hasPrefix("\(name)=") }
    return pair.map { String($0.dropFirst(name.count + 1)) }?
        .replacingOccurrences(of: "+", with: " ")
        .removingPercentEncoding
}

private let genreClause = FilterClause(field: .genre, mode: .include, values: ["Fantasy", "Sci-Fi"])
private let shelfClause = FilterClause(field: .shelf, mode: .exclude, values: ["12"])

// MARK: - Wire shape

struct FilterClauseEncodingTests {
    @Test func queryValueEncodesTheSharedJSONTokens() {
        let clause = FilterClause(field: .genre, mode: .exclude, values: ["Fantasy"])
        #expect(
            FilterClause.queryValue([clause])
                == #"[{"field":"genre","mode":"exclude","values":["Fantasy"]}]"#
        )
    }

    @Test func queryValueIsNilWithoutClauses() {
        #expect(FilterClause.queryValue([]) == nil)
    }

    @Test func fieldsUseTheSnakeCaseWireTokensInThePickersOrder() {
        #expect(
            FilterField.allCases.map(\.rawValue)
                == ["shelf", "tag", "genre", "author", "series", "format"]
        )
    }

    @Test func aClauseTheServerWroteDecodes() throws {
        let json = #"{"field":"shelf","mode":"include","values":["7"]}"#
        let clause = try JSONDecoder().decode(FilterClause.self, from: Data(json.utf8))
        #expect(clause == FilterClause(field: .shelf, mode: .include, values: ["7"]))
    }
}

// MARK: - Library page request

struct LibraryPageFilterQueryTests {
    private let tricky = [
        FilterClause(field: .tag, mode: .include, values: ["C++", "Science Fiction & Fantasy"]),
    ]

    private func query(_ clauses: [FilterClause]) -> [String: String?] {
        LibraryService.pageQuery(
            sort: .title, direction: .asc, formats: [], excludeFormats: [],
            stackSeries: false, cursor: nil, filter: clauses
        )
    }

    @Test func pageQueryCarriesTheClausesAsOneJSONParam() throws {
        let raw = try #require(query([genreClause, shelfClause])["filter"] ?? nil)
        let decoded = try JSONDecoder().decode([FilterClause].self, from: Data(raw.utf8))
        #expect(decoded == [genreClause, shelfClause])
    }

    @Test func pageQueryOmitsTheFilterWithoutClauses() {
        #expect(query([])["filter"] == nil)
    }

    @Test func requestURLDeliversTheFilterJSONIntactToTheFormDecoder() throws {
        let url = try #require(
            APIClient.requestURL(base: "http://host", path: "/api/ebooks", query: query(tricky))
        )
        let raw = try #require(formDecoded(url, "filter"))
        let decoded = try JSONDecoder().decode([FilterClause].self, from: Data(raw.utf8))
        #expect(decoded == tricky, "a plus or an ampersand in a value must survive the URL")
    }
}

struct LibraryPageFilterSignatureTests {
    private func signature(_ clauses: [FilterClause]) -> String {
        var filter = LibraryFilter()
        filter.clauses = clauses
        return LibraryService.pageSignature(sort: .title, direction: .asc, filter: filter)
    }

    @Test func pageSignatureWithoutClausesIsTheOneCachedBeforeFilters() {
        #expect(signature([]) == "title.asc.|hide:")
    }

    @Test func pageSignatureDiffersByClauseSet() {
        let excluded = FilterClause(field: .genre, mode: .exclude, values: ["Fantasy", "Sci-Fi"])
        #expect(signature([genreClause]) != signature([]))
        #expect(signature([genreClause]) != signature([excluded]))
        #expect(signature([genreClause]) != signature([genreClause, shelfClause]))
    }

    @Test func pageSignatureIgnoresClauseOrder() {
        #expect(signature([genreClause, shelfClause]) == signature([shelfClause, genreClause]))
    }

    @Test func pageSignatureIgnoresValueOrder() {
        let reversed = FilterClause(field: .genre, mode: .include, values: ["Sci-Fi", "Fantasy"])
        #expect(signature([genreClause]) == signature([reversed]))
    }
}

// MARK: - Shelf page request and cache

struct ShelfPageFilterTests {
    @Test func shelfPageQueryCarriesTheClausesAsOneJSONParam() throws {
        let raw = try #require(UserDataService.shelfPageQuery([genreClause])["filter"] ?? nil)
        let decoded = try JSONDecoder().decode([FilterClause].self, from: Data(raw.utf8))
        #expect(decoded == [genreClause])
    }

    @Test func shelfPageQueryIsEmptyWithoutClauses() {
        #expect(UserDataService.shelfPageQuery([]).isEmpty)
    }

    @Test func shelfPageKeyWithoutClausesIsTheUnfilteredKey() {
        #expect(CacheKey.shelfPage(7, filter: []) == "shelf_page:7")
    }

    @Test func shelfPageKeyFilesAFilteredPageUnderItsShelf() {
        #expect(CacheKey.shelfPage(7, filter: [genreClause]).hasPrefix("shelf_page:7|"))
    }

    @Test func shelfPageKeyDiffersByClauseSet() {
        #expect(
            CacheKey.shelfPage(7, filter: [genreClause])
                != CacheKey.shelfPage(7, filter: [shelfClause])
        )
    }

    @Test func shelfPageKeyIgnoresClauseOrder() {
        #expect(
            CacheKey.shelfPage(7, filter: [genreClause, shelfClause])
                == CacheKey.shelfPage(7, filter: [shelfClause, genreClause])
        )
    }

    @Test func filteredVariantsPrefixCoversOnlyThatShelfsFilteredPages() {
        let prefix = CacheKey.shelfPageFilteredPrefix(7)
        #expect(CacheKey.shelfPage(7, filter: [genreClause]).hasPrefix(prefix))
        #expect(!CacheKey.shelfPage(70, filter: [genreClause]).hasPrefix(prefix))
        #expect(!CacheKey.shelfPage(7).hasPrefix(prefix), "the unfiltered page is patched, not dropped")
    }

    @Test func aQueuedMembershipWriteHoldsOffAFilteredShelfPage() {
        let key = CacheKey.shelfPage(7, filter: [genreClause])
        #expect(OutboxScope.isBlocked(key, by: [OpKind.shelfMembership]))
    }
}

// MARK: - Persistence

struct LibraryFilterPreferenceTests {
    @Test func loadReturnsNoClausesWhenNothingIsStored() {
        #expect(LibraryFilterPreference.load(from: scratchDefaults()).clauses.isEmpty)
    }

    @Test func saveThenLoadRoundTripsTheClauses() {
        let defaults = scratchDefaults()
        LibraryFilterPreference(clauses: [genreClause, shelfClause]).save(to: defaults)
        #expect(LibraryFilterPreference.load(from: defaults).clauses == [genreClause, shelfClause])
    }

    @Test func saveWritesUnderTheLibraryFilterKey() {
        let defaults = scratchDefaults()
        LibraryFilterPreference(clauses: [genreClause]).save(to: defaults)
        #expect(defaults.object(forKey: "omnibus.library.filterClauses") != nil)
    }

    @Test func loadSkipsOnlyAClauseThisBuildCannotRead() {
        let defaults = scratchDefaults()
        defaults.set(
            [
                #"{"field":"rating","mode":"include","values":["5"]}"#,
                #"{"field":"genre","mode":"include","values":["Fantasy","Sci-Fi"]}"#,
            ],
            forKey: LibraryFilterPreference.key
        )
        #expect(LibraryFilterPreference.load(from: defaults).clauses == [genreClause])
    }
}

// MARK: - Offline mirror

private func book(
    _ id: Int64, _ title: String, tags: [String] = [], genres: [String] = [],
    authors: [String] = [], series: String? = nil, formats: [String] = []
) -> Book {
    var b = Book(id: id, filename: "\(id).epub", title: title, uniqueIdentifier: "u\(id)")
    b.subjects = tags
    b.genres = genres
    b.creators = authors.map { Contributor(name: $0) }
    b.series = series
    b.formats = formats
    return b
}

/// A scratch mirror holding `books`, promoted the way a sync pass does; returns it and its path.
private func mirror(_ books: [Book]) async throws -> (OfflineStore, String) {
    let path = FileManager.default.temporaryDirectory
        .appendingPathComponent("filter-mirror-\(UUID().uuidString).sqlite").path
    let store = OfflineStore(path: path)
    await store.open()
    let encoder = JSONEncoder()
    let rows = try books.map { LibraryIndex.row(for: $0, payload: try encoder.encode($0)) }
    await store.appendStagedBooks(rows)
    await store.promoteCompletedStaging()
    return (store, path)
}

struct LibraryFilterMirrorTests {
    private let library = [
        book(
            1, "Dune", tags: ["Science Fiction"], genres: ["Classics"],
            authors: ["Frank Herbert"], series: "Dune", formats: ["epub"]
        ),
        book(2, "Emma", tags: ["Romance"], authors: ["Jane Austen"], formats: ["m4b"]),
        book(3, "Notes"),
    ]

    /// The titles the mirror serves under `clauses`, or `nil` when it declines.
    private func titles(_ clauses: [FilterClause]) async throws -> [String]? {
        let (store, path) = try await mirror(library)
        defer { try? FileManager.default.removeItem(atPath: path) }
        var filter = LibraryFilter()
        filter.clauses = clauses
        let page = await LibraryIndex.page(
            from: store, sort: .title, direction: .asc, filter: filter, limit: 60, offset: 0
        )
        return page?.books.map(\.displayTitle)
    }

    @Test func includeTagKeepsOnlyBooksFiledUnderIt() async throws {
        let clause = FilterClause(field: .tag, mode: .include, values: ["Science Fiction"])
        #expect(try await titles([clause]) == ["Dune"])
    }

    @Test func excludeTagKeepsBooksWithNoTagsAtAll() async throws {
        let clause = FilterClause(field: .tag, mode: .exclude, values: ["Science Fiction"])
        #expect(try await titles([clause]) == ["Emma", "Notes"])
    }

    @Test func includeMatchesAnyOfItsValuesIgnoringCase() async throws {
        let clause = FilterClause(field: .tag, mode: .include, values: ["science fiction", "ROMANCE"])
        #expect(try await titles([clause]) == ["Dune", "Emma"])
    }

    @Test func genreReadsTheGenresListNotTheTags() async throws {
        let classics = FilterClause(field: .genre, mode: .include, values: ["classics"])
        let romance = FilterClause(field: .genre, mode: .include, values: ["Romance"])
        #expect(try await titles([classics]) == ["Dune"])
        #expect(try await titles([romance])?.isEmpty == true)
    }

    @Test func authorMatchesACreatorsName() async throws {
        let clause = FilterClause(field: .author, mode: .include, values: ["jane austen"])
        #expect(try await titles([clause]) == ["Emma"])
    }

    @Test func excludeAuthorKeepsBooksWithNoCreators() async throws {
        let clause = FilterClause(field: .author, mode: .exclude, values: ["Jane Austen"])
        #expect(try await titles([clause]) == ["Dune", "Notes"])
    }

    @Test func includeSeriesKeepsOnlyThatSeries() async throws {
        let clause = FilterClause(field: .series, mode: .include, values: ["dune"])
        #expect(try await titles([clause]) == ["Dune"])
    }

    @Test func excludeSeriesKeepsBooksInNoSeries() async throws {
        let clause = FilterClause(field: .series, mode: .exclude, values: ["Dune"])
        #expect(try await titles([clause]) == ["Emma", "Notes"])
    }

    @Test func includeFormatDropsABookWithNoFiles() async throws {
        let clause = FilterClause(field: .format, mode: .include, values: ["epub", "m4b"])
        #expect(try await titles([clause]) == ["Dune", "Emma"])
    }

    @Test func excludeFormatKeepsABookWithNoFiles() async throws {
        let clause = FilterClause(field: .format, mode: .exclude, values: ["epub"])
        #expect(try await titles([clause]) == ["Emma", "Notes"])
    }

    @Test func clausesCombineWithAnd() async throws {
        let formats = FilterClause(field: .format, mode: .include, values: ["epub", "m4b"])
        let notRomance = FilterClause(field: .tag, mode: .exclude, values: ["Romance"])
        #expect(try await titles([formats, notRomance]) == ["Dune"])
    }

    @Test func aClauseOfOnlyBlankValuesFiltersNothing() async throws {
        let clause = FilterClause(field: .tag, mode: .include, values: ["  "])
        #expect(try await titles([clause]) == ["Dune", "Emma", "Notes"])
    }

    @Test func totalCountsOnlyTheMatchingBooks() async throws {
        let (store, path) = try await mirror(library)
        defer { try? FileManager.default.removeItem(atPath: path) }
        var filter = LibraryFilter()
        filter.clauses = [FilterClause(field: .tag, mode: .exclude, values: ["Romance"])]
        let page = await LibraryIndex.page(
            from: store, sort: .title, direction: .asc, filter: filter, limit: 60, offset: 0
        )
        #expect(page?.total == 2)
    }

    @Test func aShelfClauseDeclinesRatherThanServingUnfilteredRows() async throws {
        let clause = FilterClause(field: .shelf, mode: .include, values: ["12"])
        #expect(try await titles([clause]) == nil)
    }

    @Test func aShelfClauseDeclinesBesideClausesTheMirrorCouldAnswer() async throws {
        let shelf = FilterClause(field: .shelf, mode: .exclude, values: ["12"])
        let tag = FilterClause(field: .tag, mode: .include, values: ["Romance"])
        #expect(try await titles([tag, shelf]) == nil)
    }
}
