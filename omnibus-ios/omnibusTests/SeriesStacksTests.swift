//  SeriesStacksTests.swift
//  Stack series on the client: the wire decode (old payloads keep loading),
//  the request and cache key, the grid projection, and the cell captions.

import Foundation
import Testing

@testable import omnibus

private func book(_ id: Int64, _ title: String, series: String? = nil, index: String? = nil) -> Book {
    var b = Book(id: id, filename: "\(id).epub", title: title, uniqueIdentifier: "u\(id)")
    b.series = series
    b.seriesIndex = index
    return b
}

private func stack(lead: Book, members: [Book], states: [StackMemberState] = []) -> SeriesStack {
    SeriesStack(leadUuid: lead.uuid, name: lead.series ?? "", seriesId: 7, members: members, states: states)
}

struct SeriesStackDecodeTests {
    @Test func userSummaryDecodesAMissingStackSeriesAsOff() throws {
        let json = #"{"id":1,"username":"a","is_admin":false,"can_upload":false,"can_edit":false,"can_download":true}"#
        let me = try JSONDecoder().decode(UserSummary.self, from: Data(json.utf8))
        #expect(me.stackSeries == false)
    }

    @Test func userSummaryCarriesStackSeriesWhenSet() throws {
        let json = #"{"id":1,"username":"a","is_admin":false,"can_upload":false,"can_edit":false,"can_download":true,"stack_series":true}"#
        let me = try JSONDecoder().decode(UserSummary.self, from: Data(json.utf8))
        #expect(me.stackSeries)
    }

    @Test func ebookLibraryDecodesWithAndWithoutStacks() throws {
        let plain = #"{"path":"/lib","books":[],"error":null,"total":null}"#
        #expect(try JSONDecoder().decode(EbookLibrary.self, from: Data(plain.utf8)).stacks.isEmpty)

        let stacked = """
            {"path":"/lib","books":[],"error":null,"total":null,"stacks":[{
              "lead_uuid":"u1","name":"Saga","series_id":7,
              "members":[{"id":1,"filename":"a.epub","unique_identifier":"u1"}],
              "states":[{"uuid":"u1","percent":40,"started":true,"finished":false}]}]}
            """
        let library = try JSONDecoder().decode(EbookLibrary.self, from: Data(stacked.utf8))
        let first = try #require(library.stacks.first)
        #expect(first.leadUuid == "u1")
        #expect(first.seriesId == 7)
        #expect(first.members.map(\.uuid) == ["u1"])
        #expect(first.state(of: "u1")?.percent == 40)
    }

    @Test func frontIsTheFirstStartedUnfinishedVolumeElseTheFirst() {
        let one = book(1, "One", series: "Saga", index: "1")
        let two = book(2, "Two", series: "Saga", index: "2")
        #expect(stack(lead: one, members: [one, two]).front?.id == 1)
        let reading = stack(lead: one, members: [one, two], states: [
            StackMemberState(uuid: "u1", percent: nil, started: true, finished: true),
            StackMemberState(uuid: "u2", percent: 30, started: true, finished: false),
        ])
        #expect(reading.front?.id == 2)
    }
}

struct SeriesStackRequestTests {
    @Test func pageSignatureDiffersWhenStacked() {
        var stacked = LibraryFilter()
        stacked.stackSeries = true
        #expect(
            LibraryService.pageSignature(sort: .title, direction: .asc, filter: .none)
                != LibraryService.pageSignature(sort: .title, direction: .asc, filter: stacked),
            "a toggle must miss the cached first page"
        )
    }

    @Test func pageQueryAsksForStacksOnlyWhenStacked() {
        let off = LibraryService.pageQuery(
            sort: .title, direction: .asc, formats: [], excludeFormats: [],
            stackSeries: false, cursor: nil
        )
        let on = LibraryService.pageQuery(
            sort: .title, direction: .asc, formats: [], excludeFormats: [],
            stackSeries: true, cursor: nil
        )
        #expect(off["stack_series"] == nil)
        #expect(on["stack_series"] == "true")
    }

    @Test func aCachedPageFromBeforeStacksStillDecodes() throws {
        let cached = #"{"books":[],"nextCursor":"c1"}"#
        let page = try JSONDecoder().decode(LibraryPageResult.self, from: Data(cached.utf8))
        #expect(page.stacks == nil)
        #expect(page.nextCursor == "c1")
    }
}

struct SeriesStackCacheTests {
    @Test func aStackedFirstPageCachesNoReadingState() async throws {
        await OfflineStore.shared.open()
        let key = CacheKey.libraryPage("test-\(UUID().uuidString)|stack")
        let one = book(1, "One", series: "Saga", index: "1")
        let two = book(2, "Two", series: "Saga", index: "2")
        let reading = [StackMemberState(uuid: "u2", percent: 40, started: true, finished: false)]
        let page = LibraryPageResult(
            books: [one], stacks: [stack(lead: one, members: [one, two], states: reading)]
        )

        var live: LibraryPageResult?
        let reads = LibraryService.firstPage(
            signature: String(key.dropFirst(CacheKey.libraryPagePrefix.count)),
            fetch: { page }, fallback: { LibraryPageResult(books: []) }
        )
        for try await read in reads { live = read.value }
        let cached: LibraryPageResult? = await Cache.read(key)
        await OfflineStore.shared.cacheDelete(key)

        #expect(live?.stacks?.first?.states == reading, "the live answer keeps the viewer's state")
        #expect(cached?.stacks?.first?.members.count == 2)
        #expect(cached?.stacks?.first?.states == [], "the library-wide replica keeps none")
    }
}

@MainActor
struct LibraryModelStackTests {
    /// A model on throwaway defaults, so the host's saved sort is never touched.
    private func model() -> LibraryModel {
        let name = "omnibus.tests.stacks.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return LibraryModel(defaults: defaults)
    }

    @Test func reloadFoldsTheOpenStack() async {
        let model = model()
        model.openSeries = "u2"
        await model.reload()
        #expect(model.openSeries == nil, "a re-sorted page can lead the series with another volume")
    }
}

struct LibraryGridItemsTests {
    private let one = book(1, "Saga One", series: "Saga", index: "1")
    private let two = book(2, "Saga Two", series: "Saga", index: "2")
    private let lone = book(3, "Lone")

    private var stacks: [String: SeriesStack] {
        LibraryModel.stackIndex([stack(lead: one, members: [one, two])])
    }

    @Test func unstackedBooksAreOneCellEach() {
        let items = LibraryModel.gridItems(books: [one, lone], stacks: [:], open: nil)
        #expect(items.map(\.id) == ["book-u1", "book-u3"])
    }

    @Test func aClosedStackTakesItsLeadsSlot() {
        let items = LibraryModel.gridItems(books: [lone, one], stacks: stacks, open: nil)
        #expect(items.map(\.id) == ["book-u3", "stack-u1"])
    }

    @Test func anOpenStackDealsItsVolumesAfterTheHeadCard() {
        let items = LibraryModel.gridItems(books: [one, lone], stacks: stacks, open: "u1")
        #expect(items.map(\.id) == ["cap-u1", "vol-u1-u1", "vol-u1-u2", "book-u3"])
        #expect(items.dropLast().allSatisfy { $0.anchor.id == 1 }, "every run cell pages off the lead")
    }

    @Test func aOneMemberStackStaysAPlainBook() {
        let single = LibraryModel.stackIndex([stack(lead: one, members: [one])])
        #expect(LibraryModel.gridItems(books: [one], stacks: single, open: "u1").map(\.id) == ["book-u1"])
    }
}

struct StackPresentationTests {
    @Test func volumeTitleUsesTheSeriesIndexElseTheTitle() {
        #expect(StackPresentation.volumeTitle(book(1, "Saga One", series: "Saga", index: "2.5")) == "Vol. 2.5")
        #expect(StackPresentation.volumeTitle(book(2, "Side Story", series: "Saga")) == "Side Story")
    }

    @Test func volumeSubtitleReportsReadThenPercentThenAuthor() {
        var b = book(1, "One")
        b.creators = [Contributor(name: "Ann")]
        let finished = StackMemberState(uuid: "u1", percent: 100, started: true, finished: true)
        let reading = StackMemberState(uuid: "u1", percent: 40, started: true, finished: false)
        #expect(StackPresentation.volumeSubtitle(b, state: finished) == "Read")
        #expect(StackPresentation.volumeSubtitle(b, state: reading) == "40% read")
        #expect(StackPresentation.volumeSubtitle(b, state: nil) == "Ann")
    }

    @Test func segmentsAppearOnlyOnceAVolumeIsStarted() {
        let one = book(1, "One", series: "Saga", index: "1")
        let two = book(2, "Two", series: "Saga", index: "2")
        #expect(StackPresentation.segments(stack(lead: one, members: [one, two])) == nil)
        let started = stack(lead: one, members: [one, two], states: [
            StackMemberState(uuid: "u1", percent: nil, started: true, finished: true),
            StackMemberState(uuid: "u2", percent: 25, started: true, finished: false),
        ])
        #expect(StackPresentation.segments(started) == [1, 0.25])
    }

    @Test func slugLowercasesAndHyphenates() {
        #expect(StackPresentation.slug("The Expanse: Book #1") == "the-expanse-book-1")
    }
}
