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

/// Polls `condition` on the main actor until it holds or `timeout` passes.
@MainActor
private func eventually(timeout: Duration = .seconds(5), _ condition: () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(20))
    }
    return condition()
}

/// An empty scratch replica and its path, for tests that read or wipe keys.
private func scratchStore() async -> (OfflineStore, String) {
    let path = FileManager.default.temporaryDirectory
        .appendingPathComponent("filter-store-\(UUID().uuidString).sqlite").path
    let store = OfflineStore(path: path)
    await store.open()
    return (store, path)
}

/// The first library page key read under `clauses`.
private func libraryKey(_ clauses: [FilterClause]) -> String {
    var filter = LibraryFilter()
    filter.clauses = clauses
    return CacheKey.libraryPage(
        LibraryService.pageSignature(sort: .title, direction: .asc, filter: filter)
    )
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

// MARK: - The shared clause list

@MainActor
struct LibraryFilterStoreTests {
    @Test func storeStartsWithTheSavedClauses() {
        let defaults = scratchDefaults()
        LibraryFilterPreference(clauses: [genreClause]).save(to: defaults)
        #expect(LibraryFilterStore(defaults: defaults).clauses == [genreClause])
    }

    @Test func addWritesTheClauseThrough() {
        let defaults = scratchDefaults()
        let store = LibraryFilterStore(defaults: defaults)
        store.add(genreClause)
        #expect(store.clauses == [genreClause])
        #expect(LibraryFilterPreference.load(from: defaults).clauses == [genreClause])
    }

    @Test func addRefusesAClauseWithNoValues() {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        store.add(FilterClause(field: .tag, mode: .include, values: []))
        #expect(store.clauses.isEmpty)
    }

    @Test func addTakesSixteenClausesAndRefusesTheSeventeenth() {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        for index in 0..<17 {
            store.add(FilterClause(field: .tag, mode: .include, values: ["t\(index)"]))
        }
        #expect(store.clauses.count == 16)
        #expect(!store.canAdd(reservingFormatClause: false))
    }

    @Test func addTakesSixtyFourValuesAndRefusesSixtyFive() {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        let full = (0..<64).map { "v\($0)" }
        store.add(FilterClause(field: .tag, mode: .include, values: full))
        store.add(FilterClause(field: .tag, mode: .include, values: full + ["v64"]))
        #expect(store.clauses.map(\.values.count) == [64])
    }

    @Test func canAddStopsAtTheServersSixteenClauses() {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        for index in 0..<15 {
            store.add(FilterClause(field: .tag, mode: .include, values: ["t\(index)"]))
        }
        #expect(store.canAdd(reservingFormatClause: false))
        store.add(FilterClause(field: .tag, mode: .include, values: ["t15"]))
        #expect(!store.canAdd(reservingFormatClause: false))
    }

    @Test func canAddLeavesRoomForTheCategorysFormatsAsASixteenthClause() {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        for index in 0..<14 {
            store.add(FilterClause(field: .tag, mode: .include, values: ["t\(index)"]))
        }
        #expect(store.canAdd(reservingFormatClause: true))
        store.add(FilterClause(field: .tag, mode: .include, values: ["t14"]))
        #expect(!store.canAdd(reservingFormatClause: true), "the server counts ?formats= as one more clause")
    }

    @Test func removeDropsOnlyTheClauseAtThatIndex() {
        let defaults = scratchDefaults()
        let store = LibraryFilterStore(defaults: defaults)
        store.add(genreClause)
        store.add(shelfClause)
        store.remove(at: 0)
        #expect(store.clauses == [shelfClause])
        #expect(LibraryFilterPreference.load(from: defaults).clauses == [shelfClause])
    }

    @Test func removeIgnoresAnIndexOutOfRange() {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        store.add(genreClause)
        store.remove(at: 1)
        #expect(store.clauses == [genreClause])
    }

    @Test func clearRemovesEveryClauseInOneAction() {
        let defaults = scratchDefaults()
        let store = LibraryFilterStore(defaults: defaults)
        store.add(genreClause)
        store.add(shelfClause)
        store.clear()
        #expect(store.clauses.isEmpty)
        #expect(LibraryFilterPreference.load(from: defaults).clauses.isEmpty)
    }
}

@MainActor
struct LibraryModelFilterTests {
    private func model(_ store: LibraryFilterStore) -> LibraryModel {
        LibraryModel(defaults: scratchDefaults(), filters: store)
    }

    private let stale = Book(id: 1, filename: "stale.epub", title: "Stale", uniqueIdentifier: "stale")

    @Test func theGridIsReadUnderTheSharedClauses() {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        let model = model(store)
        store.add(genreClause)
        #expect(model.activeFilter.clauses == [genreClause])
    }

    @Test func changingTheClausesReloadsTheGrid() async {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        let model = model(store)
        model.books = [stale]
        store.add(FilterClause(field: .tag, mode: .include, values: ["no-such-tag-\(UUID().uuidString)"]))
        let reloaded = await eventually { model.books.isEmpty }
        #expect(reloaded, "a clause change re-reads the grid under the new filter")
    }

    @Test func aShelfChangeReloadsAGridFilteredByShelf() async {
        let defaults = scratchDefaults()
        LibraryFilterPreference(clauses: [shelfClause]).save(to: defaults)
        let model = model(LibraryFilterStore(defaults: defaults))
        model.books = [stale]
        await model.shelvesMoved()
        #expect(model.books.isEmpty, "rows read before the membership moved answer an old question")
    }

    @Test func aShelfChangeLeavesAGridWithNoShelfClause() async {
        let defaults = scratchDefaults()
        LibraryFilterPreference(clauses: [genreClause]).save(to: defaults)
        let model = model(LibraryFilterStore(defaults: defaults))
        model.books = [stale]
        await model.shelvesMoved()
        #expect(model.books.map(\.uuid) == ["stale"])
    }

    @Test func reloadingForAFilterChangeDropsTheGridDrawnUnderTheOldOne() async {
        let store = LibraryFilterStore(defaults: scratchDefaults())
        store.add(FilterClause(field: .tag, mode: .include, values: ["no-such-tag-\(UUID().uuidString)"]))
        let model = model(store)
        model.books = [stale]
        await model.reload(clearingGrid: true)
        #expect(model.books.isEmpty, "rows from another filter must never stand in for this one's")
    }

    @Test func filteredPhaseIsLoadingWhileTheReadIsInFlight() {
        let model = model(LibraryFilterStore(defaults: scratchDefaults()))
        model.isLoading = true
        #expect(model.filteredPhase == .loading)
    }

    @Test func filteredPhaseCarriesTheFailure() {
        let model = model(LibraryFilterStore(defaults: scratchDefaults()))
        model.error = "You're offline."
        #expect(model.filteredPhase == .failed("You're offline."))
    }

    @Test func filteredPhaseIsNoMatchesWhenTheReadSettlesEmpty() {
        let model = model(LibraryFilterStore(defaults: scratchDefaults()))
        #expect(model.filteredPhase == .noMatches)
    }
}

// MARK: - Chips and picker options

private func shelf(
    _ id: Int64, _ name: String, owner: Int64 = 1, username: String = "ana",
    kind: ShelfKind = .manual
) -> ShelfSummary {
    ShelfSummary(
        id: id, ownerUserId: owner, ownerUsername: username, kind: kind, name: name,
        visibility: .private, accent: nil, bookCount: 3
    )
}

struct FilterChipLabelTests {
    private let shelves = [shelf(12, "Faves"), shelf(13, "Beach", owner: 2, username: "bob")]

    @Test func chipReadsTheFieldTheModeAndEveryValue() {
        #expect(
            genreClause.chipLabel(shelves: shelves, viewerId: 1)
                == "Genre includes any of Fantasy, Sci-Fi"
        )
    }

    @Test func anExcludeChipSaysExcludes() {
        let clause = FilterClause(field: .author, mode: .exclude, values: ["Jane Austen"])
        #expect(clause.chipLabel(shelves: shelves, viewerId: 1) == "Author excludes any of Jane Austen")
    }

    @Test func formatValuesReadInCapitals() {
        let clause = FilterClause(field: .format, mode: .include, values: ["epub", "m4b"])
        #expect(clause.chipLabel(shelves: shelves, viewerId: 1) == "Format includes any of EPUB, M4B")
    }

    @Test func aShelfChipNamesTheShelfRatherThanItsId() {
        let clause = FilterClause(field: .shelf, mode: .include, values: ["12"])
        #expect(clause.chipLabel(shelves: shelves, viewerId: 1) == "Shelf includes any of Faves")
    }

    @Test func aShelfChipNamesTheOwnerOfAnotherReadersShelf() {
        let clause = FilterClause(field: .shelf, mode: .include, values: ["13"])
        #expect(clause.chipLabel(shelves: shelves, viewerId: 1) == "Shelf includes any of Beach · bob")
    }

    @Test func aShelfChipSaysWhenTheShelfIsNotThere() {
        let clause = FilterClause(field: .shelf, mode: .exclude, values: ["99"])
        #expect(
            clause.chipLabel(shelves: shelves, viewerId: 1)
                == "Shelf excludes any of unavailable shelf"
        )
    }

    @Test func aShelfChipWaitsWithAnEllipsisWhileShelvesLoad() {
        let clause = FilterClause(field: .shelf, mode: .include, values: ["12"])
        #expect(clause.chipLabel(shelves: nil, viewerId: 1) == "Shelf includes any of …")
    }
}

struct FilterOptionTests {
    @Test func shelfOptionsOfferHandPickedShelvesAndWishlistsButNoSmartOnes() {
        let options = FilterOption.shelves(
            [shelf(12, "Faves"), shelf(14, "ana's wishlist", kind: .wishlist), shelf(15, "Rule", kind: .smart)],
            viewerId: 1
        )
        #expect(options.map(\.value) == ["12", "14"])
    }

    @Test func shelfOptionsNameAnotherReadersShelfWithItsOwner() {
        let options = FilterOption.shelves([shelf(13, "Beach", owner: 2, username: "bob")], viewerId: 1)
        #expect(options.map(\.label) == ["Beach · bob"])
    }

    @Test func namedOptionsMergeSpellingsThatDifferOnlyByCase() {
        let options = FilterOption.named([
            (name: "Fantasy", count: 2), (name: "fantasy", count: 3), (name: "Horror", count: 1),
        ])
        #expect(options == [
            FilterOption(value: "Fantasy", label: "Fantasy", count: 5),
            FilterOption(value: "Horror", label: "Horror", count: 1),
        ])
    }

    @Test func namedOptionsTrimNamesAndDropBlankOnes() {
        let options = FilterOption.named([(name: "  ", count: 1), (name: " Horror ", count: 2)])
        #expect(options.map(\.value) == ["Horror"])
    }

    @Test func namedOptionsKeepANameAtTheLengthCapAndDropOnePastIt() {
        let atCap = String(repeating: "x", count: 512)
        let pastCap = String(repeating: "y", count: 513)
        let options = FilterOption.named([(name: atCap, count: 1), (name: pastCap, count: 1)])
        #expect(options.map(\.value) == [atCap])
    }

    @Test func formatOptionsOfferEveryCategoryFormatOnceInCapitals() {
        #expect(
            FilterOption.formats.map(\.value)
                == ["epub", "pdf", "mobi", "azw3", "cbz", "cbr", "m4b", "m4a", "mp3", "aac", "flac", "ogg", "opus"]
        )
        #expect(FilterOption.formats.first?.label == "EPUB")
    }
}

struct LibraryFilterErrorTests {
    @Test func anUnreachableServerReadsAsFiltersNeedingAConnection() {
        #expect(LibraryFilterError.message(for: APIError.offline).hasPrefix("Filters need a connection"))
        #expect(
            LibraryFilterError.message(for: APIError.transport("timed out"))
                .hasPrefix("Filters need a connection")
        )
    }

    @Test func aShelfFilterOnTheOfflineViewSaysTheyCantBeCombined() {
        #expect(
            LibraryFilterError.message(for: LibraryFilterError.shelfOnDevice)
                == "Shelf filters can't be combined with the Offline view: it only knows what's on this device. Clear them to browse your downloads."
        )
    }

    @Test func anyOtherFailureIsSaidAsTheServerSaidIt() {
        #expect(
            LibraryFilterError.message(for: APIError.http(status: 500, message: ""))
                == "Server error (500)."
        )
    }
}

// MARK: - A filter the mirror can't answer

/// The error a library read finished with, or `nil` when it settled.
private func failure(of reads: AsyncThrowingStream<CacheRead<LibraryPageResult>, Error>) async -> Error? {
    do {
        for try await _ in reads {}
    } catch {
        return error
    }
    return nil
}

struct LibraryFilterDeclineTests {
    @Test func firstPageSaysFiltersNeedAConnectionWhenTheServerIsUnreachable() async {
        await OfflineStore.shared.open()
        let reads = LibraryService.firstPage(
            signature: "test-\(UUID().uuidString)",
            fetch: { throw APIError.offline },
            fallback: { throw LibraryFilterError.needsConnection }
        )
        let error = await failure(of: reads)
        #expect(error as? LibraryFilterError == .needsConnection)
    }

    @Test func theOfflineViewDeclinesAShelfClauseWithoutAskingForAConnection() async {
        var filter = LibraryCategory.downloaded.filter
        filter.clauses = [shelfClause]
        let reads = LibraryService.page(sort: .title, direction: .asc, filter: filter, cursor: nil)
        let error = await failure(of: reads)
        #expect(error as? LibraryFilterError == .shelfOnDevice, "a connection can't make this answerable")
    }

    @Test func firstPageReportsAServerErrorRatherThanTheMirrorsDecline() async {
        await OfflineStore.shared.open()
        let reads = LibraryService.firstPage(
            signature: "test-\(UUID().uuidString)",
            fetch: { throw APIError.http(status: 500, message: "") },
            fallback: { throw LibraryFilterError.needsConnection }
        )
        let error = await failure(of: reads)
        guard case .http(status: 500, _)? = error as? APIError else {
            Issue.record("expected the server's 500, got \(String(describing: error))")
            return
        }
    }
}

// MARK: - Pages a shelf clause reads

struct ShelfClausePageInvalidationTests {
    @Test func aQueuedMembershipWriteHoldsOffALibraryPageFilteredByShelf() {
        let key = libraryKey([genreClause, shelfClause])
        #expect(OutboxScope.isBlocked(key, by: [OpKind.shelfMembership]))
    }

    @Test func aQueuedMembershipWriteLeavesALibraryPageWithNoShelfClause() {
        #expect(!OutboxScope.isBlocked(libraryKey([genreClause]), by: [OpKind.shelfMembership]))
        #expect(!OutboxScope.isBlocked(libraryKey([]), by: [OpKind.shelfMembership]))
    }

    @Test func deletingByShelfClauseDropsOnlyThePagesAShelfClauseKeyed() async throws {
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("shelf-clause-\(UUID().uuidString).sqlite").path
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = OfflineStore(path: path)
        await store.open()
        let byShelf = libraryKey([shelfClause])
        let byGenre = libraryKey([genreClause])
        let unfiltered = libraryKey([])
        let otherShelfByShelf = CacheKey.shelfPage(9, filter: [shelfClause])
        for key in [byShelf, byGenre, unfiltered, otherShelfByShelf] {
            await store.cachePut(key, Data("{}".utf8))
        }

        await store.cacheDeletePrefix(CacheKey.libraryPagePrefix, containing: CacheKey.shelfClauseMarker)

        #expect(await store.cacheGet(byShelf) == nil)
        #expect(await store.cacheGet(byGenre) != nil)
        #expect(await store.cacheGet(unfiltered) != nil)
        #expect(await store.cacheGet(otherShelfByShelf) != nil, "only keys under the prefix go")
    }
}

// MARK: - Which pages a shelf write forgets

struct ShelfPageDropTests {
    /// A scratch replica holding `keys`, and its path.
    private func replica(holding keys: [String]) async -> (OfflineStore, String) {
        let (store, path) = await scratchStore()
        for key in keys {
            await store.cachePut(key, Data("{}".utf8))
        }
        return (store, path)
    }

    @Test func dropShelfPagesForgetsOnlyThatShelfsPages() async {
        let unfiltered = CacheKey.shelfPage(7)
        let filtered = CacheKey.shelfPage(7, filter: [genreClause])
        let anotherShelf = CacheKey.shelfPage(70, filter: [genreClause])
        let libraryByShelf = libraryKey([shelfClause])
        let anotherShelfByShelf = CacheKey.shelfPage(9, filter: [shelfClause])
        let (store, path) = await replica(
            holding: [unfiltered, filtered, anotherShelf, libraryByShelf, anotherShelfByShelf]
        )
        defer { try? FileManager.default.removeItem(atPath: path) }

        await UserDataService.dropShelfPages(7, in: store)

        #expect(await store.cacheGet(unfiltered) == nil)
        #expect(await store.cacheGet(filtered) == nil)
        #expect(await store.cacheGet(anotherShelf) != nil, "shelf 70 is not shelf 7")
        #expect(await store.cacheGet(libraryByShelf) != nil, "a refresh or rename moves no membership")
        #expect(await store.cacheGet(anotherShelfByShelf) != nil)
    }

    @Test func dropShelfClausePagesForgetsEveryPageAShelfClauseKeyed() async {
        let libraryByShelf = libraryKey([genreClause, shelfClause])
        let shelfByShelf = CacheKey.shelfPage(9, filter: [shelfClause])
        let libraryByGenre = libraryKey([genreClause])
        let library = libraryKey([])
        let shelfByGenre = CacheKey.shelfPage(9, filter: [genreClause])
        let shelf = CacheKey.shelfPage(9)
        let (store, path) = await replica(
            holding: [libraryByShelf, shelfByShelf, libraryByGenre, library, shelfByGenre, shelf]
        )
        defer { try? FileManager.default.removeItem(atPath: path) }

        await UserDataService.dropShelfClausePages(in: store)

        #expect(await store.cacheGet(libraryByShelf) == nil)
        #expect(await store.cacheGet(shelfByShelf) == nil)
        for kept in [libraryByGenre, library, shelfByGenre, shelf] {
            #expect(await store.cacheGet(kept) != nil, "\(kept) reads no shelf's membership")
        }
    }
}

// MARK: - Another account on the device

@MainActor
struct AccountSwitchFilterTests {
    @Test func anotherAccountSigningInDropsTheLibraryPagesAShelfClauseKeyed() async {
        let (store, path) = await scratchStore()
        defer { try? FileManager.default.removeItem(atPath: path) }
        await store.noteUser("ana")
        let byShelf = libraryKey([shelfClause])
        let unfiltered = libraryKey([])
        for key in [byShelf, unfiltered] {
            await store.cachePut(key, Data("{}".utf8))
        }

        await store.noteUser("bob")

        #expect(await store.cacheGet(byShelf) == nil, "the server resolved ana's shelves into this page")
        #expect(await store.cacheGet(unfiltered) != nil)
    }

    @Test func anotherAccountSigningInForgetsTheClauses() async {
        let (store, path) = await scratchStore()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let defaults = scratchDefaults()
        let filters = LibraryFilterStore(defaults: defaults)
        filters.add(shelfClause)
        await AuthService.noteUser("ana", in: store, filters: filters)

        await AuthService.noteUser("bob", in: store, filters: filters)

        #expect(filters.clauses.isEmpty, "a shelf id names ana's shelf, not bob's")
        #expect(LibraryFilterPreference.load(from: defaults).clauses.isEmpty)
    }

    @Test func theSameAccountSigningInAgainKeepsTheClauses() async {
        let (store, path) = await scratchStore()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let filters = LibraryFilterStore(defaults: scratchDefaults())
        filters.add(genreClause)
        await AuthService.noteUser("ana", in: store, filters: filters)

        await AuthService.noteUser("ana", in: store, filters: filters)

        #expect(filters.clauses == [genreClause])
    }
}
