//  BookRequestModelTests.swift
//  The request page's model against a hand-written fake of its API: what a load
//  reads, which lanes a poll re-reads, and what a failed read leaves on screen.

import Foundation
import Testing

@testable import omnibus

/// Records the ids the model reads singly, and how often it reads the lists.
actor ReadLog {
    private(set) var singles: [Int64] = []
    private(set) var listReads = 0

    func single(_ id: Int64) { singles.append(id) }
    func list() { listReads += 1 }
    func clear() { singles = [] }
}

let aBook = Book(id: 1, filename: "b.epub", title: "Piranesi", uniqueIdentifier: "b", formats: [])

/// A fake whose book has `listings`, answering each single read with the request of that id (from `full`).
func bookRequestAPI(
    log: ReadLog = ReadLog(), listings: [RequestListing], full: [BookRequest]? = nil, book: Book = aBook,
    wanters: [WishlistWanter] = []
) -> RequestsAPI {
    let reads = full ?? listings.map(\.request)
    return fakeRequestsAPI(
        bookList: { _ in await log.list(); return listings },
        request: { id in
            await log.single(id)
            guard let found = reads.first(where: { $0.id == id }) else { throw FakeFailure() }
            return found
        },
        book: { _ in book },
        wanters: { _ in wanters }
    )
}

@MainActor
struct BookRequestModelTests {
    private func model(_ api: RequestsAPI) -> BookRequestModel {
        BookRequestModel(uuid: "b", api: api, now: { Date(timeIntervalSince1970: 1_000) })
    }

    @Test func loadReadsTheListingsTheBookAndTheWishersThenEachLanesFullRequest() async {
        let log = ReadLog()
        let rows = [
            listing("b", id: 3, userID: 2, state: .stuck, stuckReason: .notFound),
            listing("b", id: 2, state: .onItsWay),
            listing("b", id: 1, state: .cancelled),
        ]
        let wanters = [WishlistWanter(id: 2, name: "Jordan")]
        let model = model(bookRequestAPI(log: log, listings: rows, wanters: wanters))
        await model.load(viewer: adaViewer)
        #expect(model.book?.displayTitle == "Piranesi")
        #expect(model.wanters == wanters)
        #expect(model.lanes.map(\.id) == [2, 3])
        #expect(await log.singles.sorted() == [2, 3])
        #expect(model.history.map(\.request.id) == [1])
        #expect(model.failure == nil)
    }

    @Test func aWishersFailureLeavesTheClauseOutButLoadsTheRest() async {
        let api = fakeRequestsAPI(
            bookList: { _ in [listing("b", id: 1)] }, request: { _ in aRequest(id: 1) }, book: { _ in aBook },
            wanters: { _ in throw FakeFailure() })
        let model = model(api)
        await model.load(viewer: adaViewer)
        #expect(model.wanters == nil)
        #expect(model.lanes.map(\.id) == [1])
    }

    @Test func aListingsFailureShowsTheMessageAndNoLanes() async {
        let api = fakeRequestsAPI(bookList: { _ in throw FakeFailure() }, book: { _ in aBook })
        let model = model(api)
        await model.load(viewer: adaViewer)
        #expect(model.failure == "boom")
        #expect(model.lanes.isEmpty)
    }

    @Test func aMissingBookIsReportedAsNotFound() async {
        let api = fakeRequestsAPI(
            bookList: { _ in [] }, book: { _ in throw APIError.http(status: 404, message: "") })
        let model = model(api)
        await model.load(viewer: adaViewer)
        #expect(model.isMissing)
        #expect(model.failure == nil)
    }

    @Test func aFailedReadOfTheMainRequestShowsTheMessage() async {
        let api = fakeRequestsAPI(
            bookList: { _ in [listing("b", id: 1)] }, request: { _ in throw FakeFailure() }, book: { _ in aBook })
        let model = model(api)
        await model.load(viewer: adaViewer)
        #expect(model.failure == "boom")
    }

    @Test func aBookWithNoRequestsLoadsWithNoLanes() async {
        let model = model(bookRequestAPI(listings: []))
        await model.load(viewer: adaViewer)
        #expect(model.lanes.isEmpty)
        #expect(model.book != nil)
        #expect(model.failure == nil)
    }

    @Test func theMainLaneIsTheRequestTheListFilesTheBookUnder() async {
        let rows = [listing("b", id: 3, userID: 2, state: .looking), listing("b", id: 2, state: .onItsWay)]
        let model = model(bookRequestAPI(listings: rows))
        await model.load(viewer: adaViewer)
        #expect(model.lanes.first?.id == 2)
    }

    @Test func aPollReReadsOnlyTheLanesThatAreMovingAndTheListings() async {
        let log = ReadLog()
        let rows = [
            listing("b", id: 3, userID: 2, state: .stuck, stuckReason: .notFound),
            listing("b", id: 2, state: .onItsWay, progress: 0.5),
        ]
        let model = model(bookRequestAPI(log: log, listings: rows))
        await model.load(viewer: adaViewer)
        await log.clear()
        await model.poll()
        #expect(await log.singles == [2])
        #expect(await log.listReads == 2)
    }

    @Test func aPollFollowsTheServersAnswer() async {
        let calls = CallCounter()
        let api = fakeRequestsAPI(
            bookList: { _ in [listing("b", id: 1, state: .onItsWay, progress: 0.2)] },
            request: { _ in
                await calls.next() == 1 ? aRequest(id: 1, state: .onItsWay, progress: 0.2) : aRequest(id: 1, state: .onItsWay, progress: 0.7)
            },
            book: { _ in aBook })
        let model = model(api)
        await model.load(viewer: adaViewer)
        await model.poll()
        #expect(model.lanes.first?.progress == 0.7)
    }

    @Test func aPollThatFailsKeepsTheLastLanes() async {
        let calls = CallCounter()
        let api = fakeRequestsAPI(
            bookList: { _ in
                if await calls.next() > 1 { throw FakeFailure() }
                return [listing("b", id: 1, state: .looking)]
            },
            request: { _ in aRequest(id: 1, state: .looking) }, book: { _ in aBook })
        let model = model(api)
        await model.load(viewer: adaViewer)
        await model.poll()
        #expect(model.lanes.map(\.id) == [1])
        #expect(model.failure == nil)
    }

    @Test func aPollPicksUpAnotherReadersNewRequest() async {
        let calls = CallCounter()
        let api = fakeRequestsAPI(
            bookList: { _ in
                await calls.next() == 1
                    ? [listing("b", id: 1, state: .looking)]
                    : [listing("b", id: 2, userID: 2, state: .looking), listing("b", id: 1, state: .looking)]
            },
            request: { id in aRequest(id: id, userID: id == 2 ? 2 : 1, state: .looking) }, book: { _ in aBook })
        let model = model(api)
        await model.load(viewer: adaViewer)
        await model.poll()
        #expect(model.lanes.map(\.id) == [1, 2])
    }

    @Test func pollsOnlyWhileALaneIsMovingAndNotWhileTheReaderIsChoosing() async {
        let choosing = model(bookRequestAPI(listings: [listing("b", id: 1, state: .choose)]))
        await choosing.load(viewer: adaViewer)
        #expect(choosing.pollInterval == nil)
        let moving = model(bookRequestAPI(listings: [listing("b", id: 1, state: .chosen)]))
        await moving.load(viewer: adaViewer)
        #expect(moving.pollInterval == .seconds(2))
    }

    @Test func aLanesRequesterComesFromTheMatchingListing() async throws {
        let rows = [
            aListing(aRequest(id: 1, userID: 2), requesterName: "Jordan", requesterHasAvatar: true),
        ]
        let model = model(bookRequestAPI(listings: rows))
        await model.load(viewer: adaViewer)
        let lane = try #require(model.lanes.first)
        #expect(model.listing(for: lane)?.requesterName == "Jordan")
        #expect(model.listing(for: lane)?.requesterHasAvatar == true)
    }

    @Test func offersTheKindsNothingCoversToAReaderWhoCanStart() async {
        let model = model(bookRequestAPI(listings: [listing("b", id: 1, kind: .ebook, state: .looking)]))
        await model.load(viewer: adaViewer)
        #expect(model.unrequested == [.audiobook])
    }
}
