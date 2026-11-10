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

    // MARK: - Reads racing writes and failures

    @Test func aLoadThatStartedBeforeAWriteDoesNotOverwriteTheWritesAnswer() async {
        let started = Gate()
        let release = Gate()
        let calls = CallCounter()
        let looking = aRequest(state: .looking)
        let api = fakeRequestsAPI(
            bookList: { _ in [aListing(looking)] },
            request: { _ in
                if await calls.next() > 1 {
                    await started.open()
                    await release.wait()
                }
                return looking
            },
            book: { _ in aBook },
            cancel: { _ in aCancelled(cancelAt: nil) })
        let model = model(api)
        await model.load(viewer: adaViewer)
        let reload = Task { await model.load(viewer: adaViewer) }
        await started.wait()
        await model.cancel(model.lanes[0])
        await release.open()
        await reload.value
        #expect(model.lanes.first?.state == .cancelled)
    }

    @Test func undoIsIgnoredAndTheToastKeptWhileAnotherWriteRuns() async {
        let started = Gate()
        let release = Gate()
        let undone = ReadLog()
        let api = fakeRequestsAPI(
            bookList: { _ in [] }, book: { _ in aBook },
            start: { uuid, kind in
                await started.open()
                await release.wait()
                return aRequest(id: 2, uuid: uuid, kind: kind)
            },
            undoCancel: { id in await undone.single(id); return aRequest() })
        let model = model(api)
        await model.load(viewer: adaViewer)
        let toast = RequestToast(text: "Ebook request cancelled", undoRequestID: 1)
        model.toast = toast
        let starting = Task { await model.start(.ebook) }
        await started.wait()
        await model.undo(toast)
        await release.open()
        await starting.value
        #expect(await undone.singles.isEmpty)
        #expect(model.toast == toast)
    }

    @Test func aReloadThatFailsKeepsTheLoadedPage() async {
        let calls = CallCounter()
        let api = fakeRequestsAPI(
            bookList: { _ in
                if await calls.next() > 1 { throw FakeFailure() }
                return [listing("b", id: 1, state: .looking)]
            },
            request: { _ in aRequest(id: 1, state: .looking) }, book: { _ in aBook })
        let model = model(api)
        await model.load(viewer: adaViewer)
        await model.load(viewer: adaViewer)
        #expect(model.failure == nil)
        #expect(model.lanes.map(\.id) == [1])
    }

    @Test func nextWindowCloseWakesAnObserverWhenTheClockTicksAndThenNamesTheLaterWindow() async {
        let clock = TestClock(1_000)
        let rows = [aListing(aCancelled(1, cancelAt: 1_010)), aListing(aCancelled(2, cancelAt: 1_020))]
        let model = BookRequestModel(uuid: "b", api: bookRequestAPI(listings: rows), now: { clock.date })
        await model.load(viewer: adaViewer)
        let woken = Flag()
        withObservationTracking { _ = model.nextWindowClose } onChange: { woken.raise() }
        clock.advance(to: 1_010)
        model.tick()
        #expect(woken.isRaised)
        #expect(model.nextWindowClose == Date(timeIntervalSince1970: 1_020))
    }

    // MARK: - The main lane

    @Test func aReloadKeepsTheLaneThePageOpenedOnWhenAMoreUrgentRequestAppears() async {
        let calls = CallCounter()
        let api = fakeRequestsAPI(
            bookList: { _ in
                await calls.next() == 1
                    ? [listing("b", id: 2, state: .onItsWay)]
                    : [listing("b", id: 3, userID: 2, state: .choose), listing("b", id: 2, state: .onItsWay)]
            },
            request: { id in aRequest(id: id, userID: id == 3 ? 2 : 1, state: id == 3 ? .choose : .onItsWay) },
            book: { _ in aBook })
        let model = model(api)
        await model.load(viewer: adaViewer)
        await model.load(viewer: adaViewer)
        #expect(model.lanes.map(\.id) == [2, 3])
    }

    @Test func startingOnAnEmptyPageGivesItsLaneAndPollsIt() async {
        let calls = CallCounter()
        let api = fakeRequestsAPI(
            bookList: { _ in await calls.next() == 1 ? [] : [listing("b", id: 2, state: .looking)] },
            request: { id in aRequest(id: id, state: .looking) },
            book: { _ in aBook },
            start: { uuid, kind in aRequest(id: 2, uuid: uuid, kind: kind, state: .looking) })
        let model = model(api)
        await model.load(viewer: adaViewer)
        await model.start(.ebook)
        #expect(model.lanes.map(\.id) == [2])
        #expect(model.pollInterval != nil)
    }

    // MARK: - Requester actions

    @Test func cancellingSwapsInTheCancelledLaneAndToastsAnUndoForTheGraceThatIsLeft() async {
        let log = ReadLog()
        let model = await loaded(aRequest(state: .looking), log: log) { $0.cancel = { _ in aCancelled() } }
        await model.cancel(model.lanes[0])
        #expect(model.lanes.first?.state == .cancelled)
        #expect(model.toast?.text == "Ebook request cancelled")
        #expect(model.toast?.undoRequestID == 1)
        // The server's cancel_at is 110 and the clock reads 1000, so the grace is already gone.
        #expect(model.toast?.duration == .zero)
        #expect(await log.listReads == 2)
    }

    @Test func theUndoToastLastsUntilASecondAndAHalfBeforeCancelAt() async {
        let model = await loaded(aRequest(state: .looking)) { $0.cancel = { _ in aCancelled(cancelAt: 1_010) } }
        await model.cancel(model.lanes[0])
        #expect(model.toast?.duration == .seconds(8.5))
    }

    @Test func namesAnAudiobookCancelInItsToast() async {
        let model = await loaded(aRequest(kind: .audiobook, state: .looking)) { $0.cancel = { _ in aCancelled(kind: .audiobook, cancelAt: 1_010) } }
        await model.cancel(model.lanes[0])
        #expect(model.toast?.text == "Audiobook request cancelled")
    }

    @Test func aCancelWithNoCancelAtShowsNoToast() async {
        let model = await loaded(aRequest(state: .looking)) { $0.cancel = { _ in aCancelled(cancelAt: nil) } }
        await model.cancel(model.lanes[0])
        #expect(model.lanes.first?.state == .cancelled)
        #expect(model.toast == nil)
    }

    @Test func aFailedCancelToastsItsCopyAndReReads() async {
        let log = ReadLog()
        let model = await loaded(aRequest(state: .looking), log: log) { $0.cancel = { _ in throw APIError.http(status: 409, message: "too late") } }
        await log.clear()
        await model.cancel(model.lanes[0])
        #expect(model.toast?.text == "Couldn\u{2019}t cancel: too late")
        #expect(model.toast?.undoRequestID == nil)
        #expect(await log.singles == [1])
    }

    @Test func undoRestoresWhateverTheServerReturns() async throws {
        let model = await loaded(aRequest(state: .looking)) {
            $0.cancel = { _ in aCancelled(cancelAt: 1_010) }
            $0.undoCancel = { _ in aRequest(state: .onItsWay, progress: 0.4) }
        }
        await model.cancel(model.lanes[0])
        await model.undo(try #require(model.toast))
        #expect(model.lanes.first?.state == .onItsWay)
        #expect(model.toast == nil)
    }

    @Test func aFailedUndoToastsItsCopy() async throws {
        let model = await loaded(aRequest(state: .looking)) {
            $0.cancel = { _ in aCancelled(cancelAt: 1_010) }
            $0.undoCancel = { _ in throw APIError.http(status: 409, message: "gone") }
        }
        await model.cancel(model.lanes[0])
        await model.undo(try #require(model.toast))
        #expect(model.toast?.text == "Couldn\u{2019}t undo: gone")
    }

    @Test func aChooserCancelsAnotherReadersRequestAndAnAskerCannot() async {
        let theirs = aRequest(userID: 2, state: .looking)
        let chooser = await loaded(theirs) { $0.cancel = { _ in aCancelled(userID: 2) } }
        await chooser.cancel(chooser.lanes[0])
        #expect(chooser.lanes.first?.state == .cancelled)
        let sent = ReadLog()
        let asker = await loaded(theirs, viewer: askerViewer) { $0.cancel = { id in await sent.single(id); return aCancelled(userID: 2) } }
        await asker.cancel(asker.lanes[0])
        #expect(await sent.singles.isEmpty)
        #expect(asker.lanes.first?.state == .looking)
    }

    @Test func startingARequestStaysOnThePageAndReloadsTheLanes() async {
        let log = ReadLog()
        let calls = CallCounter()
        let started = ReadLog()
        let api = fakeRequestsAPI(
            bookList: { _ in
                await log.list()
                return await calls.next() == 1
                    ? [listing("b", id: 1, kind: .ebook, state: .looking)]
                    : [listing("b", id: 2, kind: .audiobook, state: .looking), listing("b", id: 1, kind: .ebook, state: .looking)]
            },
            request: { id in aRequest(id: id, kind: id == 2 ? .audiobook : .ebook, state: .looking) },
            book: { _ in aBook },
            start: { uuid, kind in
                await started.single(kind == .audiobook ? 1 : 0)
                return aRequest(id: 2, uuid: uuid, kind: kind, state: .looking)
            })
        let model = model(api)
        await model.load(viewer: adaViewer)
        #expect(model.unrequested == [.audiobook])
        await model.start(.audiobook)
        #expect(await started.singles == [1])
        #expect(model.lanes.map(\.id) == [1, 2])
        #expect(model.unrequested.isEmpty)
        #expect(model.toast == nil)
    }

    @Test(arguments: [
        (429, "You have a lot of requests going. Try again in a few minutes."),
        (403, "Your account can\u{2019}t make requests."),
        (404, "That book is no longer in the library."),
        (500, "Couldn\u{2019}t start the request."),
    ])
    func aRefusedStartToastsItsPlainWords(status: Int, words: String) async {
        let api = fakeRequestsAPI(
            bookList: { _ in [] }, book: { _ in aBook }, start: { _, _ in throw APIError.http(status: status, message: "x") })
        let model = model(api)
        await model.load(viewer: adaViewer)
        await model.start(.ebook)
        #expect(model.toast?.text == words)
        #expect(model.busy == nil)
    }

    @Test func aReaderWhoCantStartMakesNoStart() async {
        let started = ReadLog()
        let api = fakeRequestsAPI(
            bookList: { _ in [] }, book: { _ in aBook }, start: { _, _ in await started.single(1); return aRequest() })
        let model = model(api)
        await model.load(viewer: RequestViewer(id: 1, canStart: false, canChoose: true))
        await model.start(.ebook)
        #expect(await started.singles.isEmpty)
    }

    @Test func requestAgainAppearsOnceTheUndoWindowPassesWithoutAReload() async {
        let clock = TestClock(1_000)
        let cancelledLane = aCancelled(cancelAt: 1_010)
        let api = bookRequestAPI(listings: [aListing(cancelledLane)])
        let model = BookRequestModel(uuid: "b", api: api, now: { clock.date })
        await model.load(viewer: adaViewer)
        let lane = model.lanes[0]
        #expect(!model.offersRequestAgain(lane))
        #expect(model.nextWindowClose == Date(timeIntervalSince1970: 1_010))
        clock.advance(to: 1_010)
        model.tick()
        #expect(model.offersRequestAgain(lane))
        #expect(model.nextWindowClose == nil)
    }

    @Test func requestAgainIsHeldBackWhileTheViewerHasThatKindGoingAndFromAReaderWhoCantStart() async {
        let live = aListing(aRequest(id: 2, state: .looking))
        let old = aListing(aCancelled(1, cancelAt: nil))
        let going = model(bookRequestAPI(listings: [live, old]))
        await going.load(viewer: adaViewer)
        #expect(!going.offersRequestAgain(aCancelled(1, cancelAt: nil)))
        let alone = model(bookRequestAPI(listings: [old]))
        await alone.load(viewer: adaViewer)
        #expect(alone.offersRequestAgain(aCancelled(1, cancelAt: nil)))
        let asker = model(bookRequestAPI(listings: [old]))
        await asker.load(viewer: RequestViewer(id: 1, canStart: false, canChoose: false))
        #expect(!asker.offersRequestAgain(aCancelled(1, cancelAt: nil)))
    }
}

private func aCancelled(_ id: Int64 = 1, userID: Int64 = 1, kind: RequestKind = .ebook, cancelAt: Int64? = 110) -> BookRequest {
    aRequest(id: id, userID: userID, kind: kind, state: .cancelled, cancelAt: cancelAt, cancelledBy: userID)
}

/// A flag an observation's `onChange` raises.
final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var raised = false

    var isRaised: Bool { lock.withLock { raised } }
    func raise() { lock.withLock { raised = true } }
}

/// A clock a test moves by hand.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var seconds: Double

    init(_ seconds: Double) { self.seconds = seconds }

    var date: Date { lock.withLock { Date(timeIntervalSince1970: seconds) } }
    func advance(to seconds: Double) { lock.withLock { self.seconds = seconds } }
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
    var cancel: @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() }
    var undoCancel: @Sendable (Int64) async throws -> BookRequest = { _ in throw FakeFailure() }

    var api: RequestsAPI {
        let listings = listings, full = full, log = log
        return fakeRequestsAPI(
            bookList: { _ in await log.list(); return listings },
            request: { id in
                await log.single(id)
                guard let found = full.first(where: { $0.id == id }) else { throw FakeFailure() }
                return found
            },
            book: { _ in aBook }, choose: choose, swap: swap, retry: retry, cancel: cancel, undoCancel: undoCancel,
            takeCover: takeCover, keepCover: keepCover)
    }
}
