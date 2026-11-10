//  RequestsModelTests.swift
//  The Requests list's model against a hand-written fake of its API: what a load
//  and a poll show, and how a fold choice is remembered.

import Foundation
import Testing

@testable import omnibus

/// A `RequestsAPI` whose every call fails unless the test gives it an answer.
func fakeRequestsAPI(
    list: @escaping @Sendable () async throws -> [RequestListing] = { throw FakeFailure() },
    bookList: @escaping @Sendable (String) async throws -> [RequestListing] = { _ in throw FakeFailure() },
    request: @escaping @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() },
    book: @escaping @Sendable (String) async throws -> Book = { _ in throw FakeFailure() },
    wanters: @escaping @Sendable (String) async throws -> [WishlistWanter] = { _ in [] },
    start: @escaping @Sendable (String, RequestKind) async throws -> BookRequest = { _, _ in throw FakeFailure() },
    startFromMeta: @escaping @Sendable (ExternalBookMeta) async throws -> BookRequest = { _ in throw FakeFailure() },
    resolveMeta: @escaping @Sendable (ExternalBookMeta) async throws -> ScanOutcome = { _ in .unresolved },
    choose: @escaping @Sendable (Int64, Int64) async throws -> BookRequest = { _, _ in throw FakeFailure() },
    swap: @escaping @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() },
    retry: @escaping @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() },
    cancel: @escaping @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() },
    undoCancel: @escaping @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() },
    takeCover: @escaping @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() },
    keepCover: @escaping @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() }
) -> RequestsAPI {
    RequestsAPI(
        list: list, bookList: bookList, request: request, book: book, wanters: wanters, start: start,
        startFromMeta: startFromMeta, resolveMeta: resolveMeta, choose: choose, swap: swap, retry: retry,
        cancel: cancel, undoCancel: undoCancel, takeCover: takeCover, keepCover: keepCover
    )
}

/// A defaults store of its own, so one test's folds never reach another's.
func requestDefaults() -> UserDefaults {
    UserDefaults(suiteName: "RequestsModelTests-\(UUID().uuidString)") ?? .standard
}

@MainActor
struct RequestsModelTests {
    @Test func loadShowsEveryReadersRequests() async {
        let rows = [listing("a"), listing("b", id: 2, userID: 2)]
        let model = RequestsModel(api: fakeRequestsAPI(list: { rows }), defaults: requestDefaults())
        await model.load()
        #expect(model.listings == rows)
        #expect(model.failure == nil)
    }

    @Test func loadRecordsTheFailureWhenNothingIsOnScreen() async {
        let model = RequestsModel(api: fakeRequestsAPI(list: { throw FakeFailure() }), defaults: requestDefaults())
        await model.load()
        #expect(model.listings == nil)
        #expect(model.failure == "boom")
    }

    @Test func aFailedPollKeepsTheRowsOnScreen() async {
        let calls = CallCounter()
        let rows = [listing("a", state: .looking)]
        let model = RequestsModel(
            api: fakeRequestsAPI(list: {
                if await calls.next() == 1 { return rows }
                throw FakeFailure()
            }),
            defaults: requestDefaults()
        )
        await model.load()
        await model.poll()
        #expect(model.listings == rows)
        #expect(model.failure == nil)
    }

    @Test func aSuccessfulPollReplacesTheRows() async {
        let calls = CallCounter()
        let model = RequestsModel(
            api: fakeRequestsAPI(list: {
                await calls.next() == 1 ? [listing("a", state: .looking)] : [listing("a", state: .onItsWay)]
            }),
            defaults: requestDefaults()
        )
        await model.load()
        await model.poll()
        #expect(model.listings?.first?.request.state == .onItsWay)
    }

    @Test func groupsFileUnderTheViewer() async {
        let model = RequestsModel(api: fakeRequestsAPI(list: { [listing("a", state: .choose)] }), defaults: requestDefaults())
        await model.load()
        #expect(model.groups(viewer: adaViewer).map(\.key) == [.needsYou])
        #expect(model.groups(viewer: askerViewer).map(\.key) == [.looking])
    }

    @Test func onlyCancelledStartsFolded() {
        let model = RequestsModel(api: fakeRequestsAPI(), defaults: requestDefaults())
        #expect(RequestGroupKey.allCases.filter(model.isFolded) == [.cancelled])
    }

    @Test func aToggledFoldIsRememberedByANewModel() {
        let defaults = requestDefaults()
        let model = RequestsModel(api: fakeRequestsAPI(), defaults: defaults)
        model.toggleFold(.cancelled)
        model.toggleFold(.stuck)
        let reopened = RequestsModel(api: fakeRequestsAPI(), defaults: defaults)
        #expect(!reopened.isFolded(.cancelled))
        #expect(reopened.isFolded(.stuck))
        #expect(defaults.dictionary(forKey: "omnibus.requests_folds") as? [String: Bool] == ["cancelled": false, "stuck": true])
    }

    // MARK: - Starting from the Add sheet

    private let record = ExternalBookMeta(
        isbn13: "9780441172719", title: "Dune", authors: ["Frank Herbert"], year: nil, pages: nil,
        publisher: nil, description: nil, coverURL: nil, source: "open_library"
    )

    private func libraryBook(hasFiles: Bool) -> ScanBook {
        ScanBook(uuid: "lib", title: "Dune", authors: [], coverURL: nil, hasPhysical: false, isbn: nil, hasFiles: hasFiles)
    }

    /// Records what the model started, and answers with the request it was asked for.
    private actor Started {
        var libraryStarts: [String] = []
        var metaStarts: [String] = []
        var resolves = 0

        func library(_ uuid: String) { libraryStarts.append(uuid) }
        func meta(_ title: String) { metaStarts.append(title) }
        func resolve() { resolves += 1 }
    }

    private func startingAPI(
        _ started: Started, list: [RequestListing] = [], resolved: ScanOutcome = .unresolved
    ) -> RequestsAPI {
        fakeRequestsAPI(
            list: { list },
            start: { uuid, kind in
                #expect(kind == .ebook)
                await started.library(uuid)
                return aRequest(uuid: uuid, state: .looking)
            },
            startFromMeta: { meta in
                await started.meta(meta.title)
                return aRequest(uuid: "minted", state: .looking)
            },
            resolveMeta: { _ in await started.resolve(); return resolved })
    }

    @Test func startingFromALibraryBookStartsAnEbookShowsItsPageWithoutWaitingForTheReload() async {
        let started = Started()
        let calls = CallCounter()
        let release = Gate()
        let api = fakeRequestsAPI(
            list: {
                if await calls.next() == 1 { return [] }
                await release.wait()
                return [listing("lib", state: .looking)]
            },
            start: { uuid, kind in
                #expect(kind == .ebook)
                await started.library(uuid)
                return aRequest(uuid: uuid, state: .looking)
            })
        let model = RequestsModel(api: api, defaults: requestDefaults())
        await model.load()
        let outcome = await model.startFromLibrary(uuid: "lib")
        #expect(outcome == .show(uuid: "lib"))
        #expect(await started.libraryStarts == ["lib"])
        await release.open()
        for _ in 0..<1_000 where model.listings?.isEmpty != false { await Task.yield() }
        #expect(model.listings?.map(\.book.uuid) == ["lib"])
    }

    @Test(arguments: [
        (429, "You have a lot of requests going. Try again in a few minutes."),
        (403, "Your account can\u{2019}t make requests."),
        (404, "That book is no longer in the library."),
        (500, "Couldn\u{2019}t start the request."),
    ])
    func aRefusedStartIsReportedInPlainWords(status: Int, words: String) async {
        let api = fakeRequestsAPI(start: { _, _ in throw APIError.http(status: status, message: "x") })
        let model = RequestsModel(api: api, defaults: requestDefaults())
        #expect(await model.startFromLibrary(uuid: "lib") == .failed(words))
        #expect(!model.isStarting)
    }

    @Test func aRecordMatchingNoLibraryBookStartsFromItsMeta() async {
        let started = Started()
        let model = RequestsModel(api: startingAPI(started, resolved: .notInLibrary(online: record)), defaults: requestDefaults())
        let outcome = await model.startFromRecord(record, lookup: nil)
        #expect(outcome == .show(uuid: "minted"))
        #expect(await started.metaStarts == ["Dune"])
        #expect(await started.resolves == 1)
    }

    @Test func aRecordMatchingALibraryBookWithoutFilesStartsOnThatBook() async {
        let started = Started()
        let resolved = ScanOutcome.inLibraryUnowned(book: libraryBook(hasFiles: false))
        let model = RequestsModel(api: startingAPI(started, resolved: resolved), defaults: requestDefaults())
        #expect(await model.startFromRecord(record, lookup: nil) == .show(uuid: "lib"))
        #expect(await started.libraryStarts == ["lib"])
        #expect(await started.metaStarts.isEmpty)
    }

    @Test func aRecordMatchingABookTheLibraryHoldsIsReportedAndNotStarted() async {
        let started = Started()
        let resolved = ScanOutcome.alreadyOwned(book: libraryBook(hasFiles: true))
        let model = RequestsModel(api: startingAPI(started, resolved: resolved), defaults: requestDefaults())
        #expect(await model.startFromRecord(record, lookup: nil) == .failed("Dune is already in the library."))
        #expect(await started.libraryStarts.isEmpty)
        #expect(await started.metaStarts.isEmpty)
    }

    @Test func aRecordMatchingABookAlreadyRequestedOpensItsPage() async {
        let started = Started()
        let resolved = ScanOutcome.inLibraryUnowned(book: libraryBook(hasFiles: false))
        let model = RequestsModel(api: startingAPI(started, list: [listing("lib", state: .looking)], resolved: resolved), defaults: requestDefaults())
        await model.load()
        #expect(await model.startFromRecord(record, lookup: nil) == .show(uuid: "lib"))
        #expect(await started.libraryStarts.isEmpty)
    }

    @Test func anIsbnLookupsOutcomeSpendsNoSecondResolve() async {
        let started = Started()
        let lookup = ScanOutcome.closeMatch(books: [libraryBook(hasFiles: false)], scanned: record)
        let model = RequestsModel(api: startingAPI(started), defaults: requestDefaults())
        #expect(await model.startFromRecord(record, lookup: lookup) == .show(uuid: "lib"))
        #expect(await started.resolves == 0)
    }

    @Test func aFailedResolveIsReportedAsACouldntLookUp() async {
        let api = fakeRequestsAPI(resolveMeta: { _ in throw FakeFailure() })
        let model = RequestsModel(api: api, defaults: requestDefaults())
        #expect(await model.startFromRecord(record, lookup: nil) == .failed("Couldn\u{2019}t look up Dune."))
    }

    @Test func aFailedStartFromMetaIsReportedInPlainWords() async {
        let api = fakeRequestsAPI(startFromMeta: { _ in throw APIError.http(status: 429, message: "x") })
        let model = RequestsModel(api: api, defaults: requestDefaults())
        let outcome = await model.startFromRecord(record, lookup: .notInLibrary(online: record))
        #expect(outcome == .failed("You have a lot of requests going. Try again in a few minutes."))
    }

    @Test func aSecondStartIsIgnoredWhileOneRuns() async {
        let startedGate = Gate()
        let release = Gate()
        let started = Started()
        let api = fakeRequestsAPI(start: { uuid, _ in
            await started.library(uuid)
            await startedGate.open()
            await release.wait()
            return aRequest(uuid: uuid)
        })
        let model = RequestsModel(api: api, defaults: requestDefaults())
        let first = Task { await model.startFromLibrary(uuid: "a") }
        await startedGate.wait()
        #expect(model.isStarting)
        #expect(await model.startFromLibrary(uuid: "b") == .failed("Still starting the last request."))
        await release.open()
        _ = await first.value
        #expect(await started.libraryStarts == ["a"])
    }

    @Test func startingFromALibraryBookCanAskForAnAudiobook() async {
        let sent = Started()
        let api = fakeRequestsAPI(
            list: { [] },
            start: { uuid, kind in
                await sent.library("\(uuid):\(kind.rawValue)")
                return aRequest(uuid: uuid, kind: kind)
            })
        let model = RequestsModel(api: api, defaults: requestDefaults())
        #expect(await model.startFromLibrary(uuid: "lib", kind: .audiobook) == .show(uuid: "lib"))
        #expect(await sent.libraryStarts == ["lib:audiobook"])
    }
}
