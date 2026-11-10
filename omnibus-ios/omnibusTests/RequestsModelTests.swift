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
}
