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

    // MARK: - Chooser actions

    private func loaded(_ lane: BookRequest, log: ReadLog = ReadLog(), viewer: RequestViewer = adaViewer, writes: (inout RequestsAPIFakes) -> Void) async -> BookRequestModel {
        var fakes = RequestsAPIFakes(listings: [aListing(lane)], full: [lane], log: log)
        writes(&fakes)
        let model = model(fakes.api)
        await model.load(viewer: viewer)
        return model
    }

    @Test func choosingAVersionReplacesTheLaneWithTheServersAnswerAndReReadsTheListings() async {
        let log = ReadLog()
        let chosenLane = aRequest(state: .chosen, chosenResultID: 11, versions: [aVersion()])
        let model = await loaded(aRequest(state: .choose, versions: [aVersion(), aVersion(id: 12)]), log: log) {
            $0.choose = { _, _ in chosenLane }
        }
        let listReads = await log.listReads
        await model.choose(model.lanes[0], version: 11)
        #expect(model.lanes.first?.state == .chosen)
        #expect(await log.listReads == listReads + 1)
        #expect(model.toast == nil)
        #expect(model.busy == nil)
    }

    @Test func choosingSendsTheRequestAndVersionIds() async {
        let sent = ReadLog()
        let model = await loaded(aRequest(id: 5, state: .choose, versions: [aVersion(id: 9)])) {
            $0.choose = { id, version in
                await sent.single(id)
                await sent.single(version)
                return aRequest(id: 5, state: .chosen, chosenResultID: 9)
            }
        }
        await model.choose(model.lanes[0], version: 9)
        #expect(await sent.singles == [5, 9])
    }

    @Test func aFailedChoiceToastsItsCopyAndKeepsTheLane() async {
        let model = await loaded(aRequest(state: .choose, versions: [aVersion()])) { $0.choose = { _, _ in throw APIError.http(status: 409, message: "taken") } }
        await model.choose(model.lanes[0], version: 11)
        #expect(model.toast?.text == "Couldn\u{2019}t choose that version: taken")
        #expect(model.toast?.undoRequestID == nil)
        #expect(model.lanes.first?.state == .choose)
        #expect(model.busy == nil)
    }

    @Test func swappingRetryingAndTakingOrKeepingACoverEachReplaceTheLane() async {
        let choosing = aRequest(state: .choose, versions: [aVersion()])
        let stuckLane = aRequest(state: .stuck, stuckReason: .notFound)
        let offer = CoverOffer(width: 1600, height: 2400, currentWidth: 128, currentHeight: 196)
        let readyLane = aRequest(state: .ready, coverOffer: offer)
        let swapped = await loaded(aRequest(state: .onItsWay, progress: 0.3)) { $0.swap = { _ in choosing } }
        await swapped.swap(swapped.lanes[0])
        #expect(swapped.lanes.first?.state == .choose)
        let retried = await loaded(stuckLane) { $0.retry = { _ in aRequest(state: .looking) } }
        await retried.retry(retried.lanes[0])
        #expect(retried.lanes.first?.state == .looking)
        let taken = await loaded(readyLane) { $0.takeCover = { _ in aRequest(state: .ready) } }
        await taken.takeCover(taken.lanes[0])
        #expect(taken.lanes.first?.coverOffer == nil)
        let kept = await loaded(readyLane) { $0.keepCover = { _ in aRequest(state: .ready) } }
        await kept.keepCover(kept.lanes[0])
        #expect(kept.lanes.first?.coverOffer == nil)
    }

    @Test func eachFailureToastsItsOwnCopy() async {
        let fail: @Sendable (Int64) async throws -> BookRequest = { _ in throw APIError.http(status: 500, message: "boom") }
        let swapped = await loaded(aRequest(state: .onItsWay)) { $0.swap = fail }
        await swapped.swap(swapped.lanes[0])
        #expect(swapped.toast?.text == "Couldn\u{2019}t choose another: boom")
        let retried = await loaded(aRequest(state: .stuck, stuckReason: .notFound)) { $0.retry = fail }
        await retried.retry(retried.lanes[0])
        #expect(retried.toast?.text == "Couldn\u{2019}t try again: boom")
        let taken = await loaded(aRequest(state: .ready)) { $0.takeCover = fail }
        await taken.takeCover(taken.lanes[0])
        #expect(taken.toast?.text == "Couldn\u{2019}t use that cover: boom")
        let kept = await loaded(aRequest(state: .ready)) { $0.keepCover = fail }
        await kept.keepCover(kept.lanes[0])
        #expect(kept.toast?.text == "Couldn\u{2019}t keep this one: boom")
    }

    @Test func aFailedCoverWriteReReadsTheLaneAndTheListings() async {
        let log = ReadLog()
        let model = await loaded(aRequest(state: .ready), log: log) { $0.takeCover = { _ in throw APIError.http(status: 409, message: "gone") } }
        await log.clear()
        let listReads = await log.listReads
        await model.takeCover(model.lanes[0])
        #expect(await log.singles == [1])
        #expect(await log.listReads == listReads + 1)
    }

    @Test func aFailedChoiceDoesNotReRead() async {
        let log = ReadLog()
        let model = await loaded(aRequest(state: .choose, versions: [aVersion()]), log: log) { $0.choose = { _, _ in throw FakeFailure() } }
        await log.clear()
        await model.choose(model.lanes[0], version: 11)
        #expect(await log.singles.isEmpty)
    }

    @Test func aSecondWriteIsIgnoredWhileOneRuns() async {
        let started = Gate()
        let release = Gate()
        let sent = ReadLog()
        let lane = aRequest(state: .choose, versions: [aVersion(), aVersion(id: 12)])
        let model = await loaded(lane) {
            $0.choose = { _, version in
                await sent.single(version)
                await started.open()
                await release.wait()
                return aRequest(state: .chosen, chosenResultID: version)
            }
        }
        let first = Task { await model.choose(model.lanes[0], version: 11) }
        await started.wait()
        #expect(model.busy == .choosing(request: 1, version: 11))
        await model.choose(model.lanes[0], version: 12)
        await release.open()
        await first.value
        #expect(await sent.singles == [11])
    }

    @Test func aReaderWhoCantPickVersionsMakesNoChooserWrite() async {
        let sent = ReadLog()
        let model = await loaded(aRequest(state: .choose, versions: [aVersion()]), viewer: askerViewer) {
            $0.choose = { id, _ in await sent.single(id); return aRequest(state: .chosen) }
        }
        await model.choose(model.lanes[0], version: 11)
        #expect(await sent.singles.isEmpty)
    }

    @Test func aPollThatStartedBeforeAWriteIsDroppedWhenItAnswersAfterIt() async {
        let started = Gate()
        let release = Gate()
        let calls = CallCounter()
        let downloading = aRequest(state: .onItsWay, progress: 0.2)
        let api = fakeRequestsAPI(
            bookList: { _ in [aListing(downloading)] },
            request: { _ in
                if await calls.next() > 1 {
                    await started.open()
                    await release.wait()
                }
                return downloading
            },
            book: { _ in aBook },
            swap: { _ in aRequest(state: .choose, versions: [aVersion()]) })
        let model = model(api)
        await model.load(viewer: adaViewer)
        let poll = Task { await model.poll() }
        await started.wait()
        await model.swap(model.lanes[0])
        await release.open()
        await poll.value
        #expect(model.lanes.first?.state == .choose)
    }
}

/// The calls a chooser action makes, overridable one at a time; every read answers from `full`.
struct RequestsAPIFakes {
    var listings: [RequestListing]
    var full: [BookRequest]
    var log: ReadLog
    var choose: @Sendable (Int64, Int64) async throws -> BookRequest = { _, _ in throw FakeFailure() }
    var swap: @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() }
    var retry: @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() }
    var takeCover: @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() }
    var keepCover: @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() }

    var api: RequestsAPI {
        let listings = listings, full = full, log = log
        return fakeRequestsAPI(
            bookList: { _ in await log.list(); return listings },
            request: { id in
                await log.single(id)
                guard let found = full.first(where: { $0.id == id }) else { throw FakeFailure() }
                return found
            },
            book: { _ in aBook }, choose: choose, swap: swap, retry: retry, takeCover: takeCover, keepCover: keepCover)
    }
}
