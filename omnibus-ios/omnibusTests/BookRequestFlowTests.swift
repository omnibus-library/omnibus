//  BookRequestFlowTests.swift
//  The request page's copy and gating, ported from the web's `requestView.test.ts`
//  (phone cases only). Copy is asserted byte for byte: curly quotes, the NBSP
//  before a separator, and the NBSPs around a size's multiplication sign.

import Foundation
import Testing

@testable import omnibus

private let nbsp = "\u{a0}"
private let sep = "\u{a0}\u{b7} "
private let apostrophe = "\u{2019}"

/// A moment `secs` after the epoch.
private func at(_ secs: Double) -> Date { Date(timeIntervalSince1970: secs) }

private let ada = RequestViewer(id: 1, canStart: true, canChoose: false)

struct BookRequestFlowTests {
    struct StateView {
        @Test(arguments: [
            (RequestState.looking, "Looking"), (.choose, "Choose a version"), (.chosen, "Version chosen"),
            (.onItsWay, "On its way"), (.stuck, "Couldn\u{2019}t find it"), (.cancelled, "Cancelled"),
            (.ready, "Ready to read"),
        ])
        func headsEachState(state: RequestState, heading: String) {
            #expect(BookRequestFlow.stateView(state).heading == heading)
        }

        @Test func headsEachStuckReason() {
            #expect(BookRequestFlow.stateView(.stuck, stuckReason: .stoppedMoving).heading == "Stopped moving")
            #expect(BookRequestFlow.stateView(.stuck, stuckReason: .searchFailed).heading == "Couldn\u{2019}t find it")
            #expect(BookRequestFlow.stateView(.stuck, stuckReason: .couldntAdd).heading == "Couldn\u{2019}t add it")
        }

        @Test func givesChooseNoNoteSinceTheVersionsCarryIt() {
            #expect(BookRequestFlow.stateView(.choose).note == nil)
        }

        @Test func namesAReadyAudiobookReadyToListen() {
            let view = BookRequestFlow.stateView(.ready, kind: .audiobook)
            #expect(view == RequestStateView(heading: "Ready to listen", note: "It\u{2019}s in the library."))
        }

        @Test func putsTheRecordedErrorUnderAStuckHeadingWithItsFirstLetterCapitalised() {
            let view = BookRequestFlow.stateView(
                .stuck, stuckReason: .stoppedMoving, stuckDetail: "the download made no progress for 12 hours")
            #expect(
                view == RequestStateView(
                    heading: "Stopped moving", note: "The download made no progress for 12 hours", explicit: true))
        }

        @Test func leavesANameOpeningWithALowerCaseLetterAndACapitalAsWritten() {
            let view = BookRequestFlow.stateView(
                .stuck, stuckReason: .stoppedMoving, stuckDetail: "qBittorrent did not accept the torrent")
            #expect(view.note == "qBittorrent did not accept the torrent")
        }

        @Test(arguments: [
            (StuckReason.notFound, "Nothing worth showing turned up."),
            (.stoppedMoving, "The download stopped making progress."),
            (.couldntAdd, "It downloaded but couldn\u{2019}t be added to the library."),
        ])
        func fallsBackToAGeneralLineWhenNoErrorWasRecorded(reason: StuckReason, note: String) {
            let view = BookRequestFlow.stateView(.stuck, stuckReason: reason, stuckDetail: nil)
            #expect(view.note == note)
            #expect(!view.explicit)
        }

        @Test func neverUsesTheDownloadersWords() {
            let words = ["release", "torrent", "indexer", "grab", "seed"]
            let all: [(RequestState, StuckReason?)] = [
                (.looking, nil), (.choose, nil), (.chosen, nil), (.onItsWay, nil), (.ready, nil),
                (.stuck, .notFound), (.stuck, .stoppedMoving), (.stuck, .couldntAdd), (.cancelled, nil),
            ]
            for (state, reason) in all {
                let view = BookRequestFlow.stateView(state, stuckReason: reason)
                let text = "\(view.heading) \(view.note ?? "")".lowercased()
                #expect(!words.contains { text.contains($0) })
            }
        }
    }

    struct Steps {
        private func steps(_ request: BookRequest) -> [BookRequestFlow.Step]? { BookRequestFlow.steps(request) }

        @Test func makesLookingTheCurrentStepOfASearch() {
            #expect(
                steps(aRequest(state: .looking)) == [
                    .init(label: "Looking", status: .current, percent: nil),
                    .init(label: "Choose a version", status: .todo, percent: nil),
                    .init(label: "On its way", status: .todo, percent: nil),
                    .init(label: "Ready", status: .todo, percent: nil),
                ])
        }

        @Test func countsEveryVersionFoundOnceTheReaderIsChoosing() {
            let found = [aVersion(id: 1), aVersion(id: 2, rejected: true)]
            #expect(
                steps(aRequest(state: .choose, versions: found)) == [
                    .init(label: "Looking \u{b7} 2 found", status: .done, percent: nil),
                    .init(label: "Choose a version", status: .current, percent: nil),
                    .init(label: "On its way", status: .todo, percent: nil),
                    .init(label: "Ready", status: .todo, percent: nil),
                ])
        }

        @Test func namesThePickMadeAndCarriesTheDownloadsPercent() {
            let downloading = steps(
                aRequest(state: .onItsWay, chosenResultID: 11, progress: 0.62, versions: [aVersion()]))
            #expect(
                downloading?[1...2].map { $0 } == [
                    .init(label: "Chose a version", status: .done, percent: nil),
                    .init(label: "On its way", status: .current, percent: 62),
                ])
        }

        @Test func leavesThePercentOffAPickedVersionNotYetStarted() {
            #expect(
                steps(aRequest(state: .chosen, versions: [aVersion()]))?[2]
                    == .init(label: "On its way", status: .current, percent: nil))
        }

        @Test func marksEveryStepDoneOnceTheBookIsReady() {
            #expect(steps(aRequest(state: .ready, versions: [aVersion()]))?.map(\.status) == [.done, .done, .done, .done])
        }

        @Test(arguments: [RequestState.stuck, .cancelled])
        func hasNoStepsForAStuckOrCancelledRequest(state: RequestState) {
            #expect(steps(aRequest(state: state)) == nil)
        }
    }

    struct Progress {
        @Test func roundsDownSoABarNeverReadsDoneBeforeItIs() {
            #expect(BookRequestFlow.progressPercent(0.426) == 42)
            #expect(BookRequestFlow.progressPercent(0.999) == 99)
            #expect(BookRequestFlow.progressPercent(0.99996) == 99)
        }

        @Test func readsAWholePercentThroughFloatingPointNoise() {
            #expect(BookRequestFlow.progressPercent(0.29) == 29)
        }

        @Test func readsAFinishedDownloadAs100AndAnUnreadOneAs0() {
            #expect(BookRequestFlow.progressPercent(1) == 100)
            #expect(BookRequestFlow.progressPercent(nil) == 0)
        }

        @Test(arguments: [
            (RequestState.onItsWay, nil, nil), (.onItsWay, 0.62, 62), (.onItsWay, 1, nil),
            (.stuck, 0.4, nil), (.chosen, nil, nil),
        ] as [(RequestState, Double?, Int?)])
        func showsAPercentOnlyWhileADownloadRuns(state: RequestState, progress: Double?, expected: Int?) {
            #expect(BookRequestFlow.downloadPercent(aRequest(state: state, progress: progress)) == expected)
        }

        @Test(arguments: [
            (RequestState.onItsWay, nil, true), (.onItsWay, 0.99, true), (.onItsWay, 1, false),
            (.chosen, nil, false), (.stuck, 0.4, false),
        ] as [(RequestState, Double?, Bool)])
        func isDownloadingOnlyForAnUnfinishedOnItsWay(state: RequestState, progress: Double?, expected: Bool) {
            #expect(BookRequestFlow.isDownloading(aRequest(state: state, progress: progress)) == expected)
        }
    }

    struct TimeLeft {
        private func left(_ secs: Int64, progress: Double? = 0.5) -> String? {
            BookRequestFlow.timeLeft(aRequest(progress: progress, expectedDoneAt: 1_000 + secs), now: at(1_000))
        }

        @Test(arguments: [
            (1, "less than a minute left"), (59, "less than a minute left"), (60, "about 1 min left"),
            (150, "about 3 min left"), (3540, "about 59 min left"), (3599, "about 1 hour left"),
            (3600, "about 1 hour left"), (7200, "about 2 hours left"),
        ] as [(Int64, String)])
        func readsTheSecondsToGo(secs: Int64, expected: String) {
            #expect(left(secs) == expected)
        }

        @Test func saysNothingWhenTheClientCantTellTheTimeHasComeOrTheDownloadIsComplete() {
            #expect(BookRequestFlow.timeLeft(aRequest(progress: 0.5, expectedDoneAt: nil), now: at(1_000)) == nil)
            #expect(left(0) == nil)
            #expect(left(-30) == nil)
            #expect(left(120, progress: 1) == nil)
        }
    }

    struct Recency {
        @Test(arguments: [
            (0, "just now"), (89, "just now"), (90, "1m ago"), (720, "12m ago"), (3599, "59m ago"),
            (3600, "1h ago"), (10_800, "3h ago"), (47 * 3600, "yesterday"), (48 * 3600 - 1, "yesterday"),
            (48 * 3600, "2d ago"), (5 * 86_400, "5d ago"),
        ] as [(Int64, String)])
        func readsHowLongAgo(secs: Int64, expected: String) {
            #expect(BookRequestFlow.recency(since: 1_000, now: at(1_000 + Double(secs))) == expected)
        }

        @Test func neverReadsTheFuture() {
            #expect(BookRequestFlow.recency(since: 2_000, now: at(1_000)) == "just now")
        }
    }

    struct Versions {
        @Test func writesASizeInDecimalUnitsAndLeavesAMissingOneOut() {
            #expect(BookRequestFlow.versionSize(2_400_000) == "2.4\(nbsp)MB")
            #expect(BookRequestFlow.versionSize(1_800_000_000) == "1.8\(nbsp)GB")
            #expect(BookRequestFlow.versionSize(512) == "512\(nbsp)B")
            #expect(BookRequestFlow.versionSize(nil) == nil)
            #expect(BookRequestFlow.versionSize(0) == nil)
            #expect(BookRequestFlow.versionSize(-5) == nil)
        }

        @Test func namesTheSourceFormatSizeAndSeeds() {
            #expect(
                BookRequestFlow.versionSource(aVersion(sizeBytes: 1_800_000))
                    == "MyAnonamouse\(sep)EPUB\(sep)1.8\(nbsp)MB\(sep)142\(nbsp)seeds")
        }

        @Test func dropsAMissingSourceAndMissingSeeds() {
            #expect(
                BookRequestFlow.versionSource(aVersion(sizeBytes: 1_800_000, indexer: nil, seeders: nil))
                    == "EPUB\(sep)1.8\(nbsp)MB")
        }

        @Test func endsAUsenetVersionsLineWithUsenetInPlaceOfSeeds() {
            let usenet = aVersion(sizeBytes: 2_100_000, indexer: "NZBgeek", seeders: nil, protocol: .usenet)
            #expect(BookRequestFlow.versionSource(usenet) == "NZBgeek\(sep)EPUB\(sep)2.1\(nbsp)MB\(sep)Usenet")
        }

        @Test func saysWhenTheFormatAndSizeAreUnknown() {
            let unknown = aVersion(sizeBytes: nil, format: nil, seeders: nil)
            #expect(BookRequestFlow.versionSource(unknown) == "MyAnonamouse\(sep)Format unknown\(sep)Size unknown")
        }

        @Test(arguments: [(1, "1\u{a0}seed"), (0, "0\u{a0}seeds"), (1234, "1,234\u{a0}seeds")] as [(Int64, String)])
        func writesSeedersWithAPluralAndAThousandsSeparator(seeders: Int64, words: String) {
            #expect(
                BookRequestFlow.versionSource(aVersion(sizeBytes: 1_800_000, indexer: nil, seeders: seeders))
                    == "EPUB\(sep)1.8\(nbsp)MB\(sep)\(words)")
        }

        @Test(arguments: [
            ("AZW3", true), ("MOBI", true), ("EPUB", false), ("PDF", false), ("CBZ", false), (nil, false),
        ] as [(String?, Bool)])
        func convertsToEpubOnlyForAzw3AndMobi(format: String?, expected: Bool) {
            #expect(BookRequestFlow.convertsToEpub(aVersion(format: format)) == expected)
        }

        @Test func namesThePickedVersionsSizeAndSourceLeavingOutWhatIsUnknown() {
            #expect(BookRequestFlow.pickedMeta(aVersion(sizeBytes: 1_800_000)) == "1.8\(nbsp)MB\(sep)MyAnonamouse")
            #expect(BookRequestFlow.pickedMeta(aVersion(sizeBytes: nil, indexer: nil)) == "")
        }

        @Test func headsAPickedVersionWithItsFormatAndSize() {
            #expect(BookRequestFlow.pickedHeading(aVersion(sizeBytes: 3_100_000)) == "EPUB\(sep)3.1\(nbsp)MB")
            #expect(BookRequestFlow.pickedHeading(aVersion(sizeBytes: nil, format: nil)) == "")
        }

        @Test func countsOnlyTheVersionsThatCanBeChosen() {
            let versions = [aVersion(id: 1, bestMatch: true), aVersion(id: 2), aVersion(id: 3, rejected: true)]
            #expect(BookRequestFlow.versionsFound(versions) == "2 versions found \u{b7} Best match first")
        }

        @Test func namesNoBestMatchWhenNoVersionThatCanBeChosenIsOne() {
            let versions = [aVersion(id: 1), aVersion(id: 2, bestMatch: true, rejected: true)]
            #expect(BookRequestFlow.versionsFound(versions) == "1 version found")
        }

        @Test func keepsTheFirstFourChoosableVersionsAndEveryTriedOne() {
            let versions = (1...6).map { aVersion(id: Int64($0)) } + [aVersion(id: 7, rejected: true)]
            #expect(BookRequestFlow.firstShown(versions).map(\.id) == [1, 2, 3, 4, 7])
        }

        @Test func keepsEveryVersionWhenFourOrFewerCanBeChosen() {
            let four = (1...4).map { aVersion(id: Int64($0)) } + [aVersion(id: 5, rejected: true)]
            #expect(BookRequestFlow.firstShown(four).map(\.id) == [1, 2, 3, 4, 5])
            let five = (1...5).map { aVersion(id: Int64($0)) }
            #expect(BookRequestFlow.firstShown(five).map(\.id) == [1, 2, 3, 4])
        }

        @Test func namesBothCoverSizesWithoutSayingWhereTheExistingOneCameFrom() {
            let offer = CoverOffer(width: 1600, height: 2400, currentWidth: 128, currentHeight: 196)
            #expect(
                BookRequestFlow.coverSizesLine(offer)
                    == "Its cover is 1600\(nbsp)\u{d7}\(nbsp)2400. The existing one is 128\(nbsp)\u{d7}\(nbsp)196.")
        }
    }

    struct Failures {
        @Test(arguments: [
            (429, "You have a lot of requests going. Try again in a few minutes."),
            (403, "Your account can\u{2019}t make requests."),
            (404, "That book is no longer in the library."),
            (500, "Couldn\u{2019}t start the request."),
        ])
        func explainsAStartFailureInPlainWords(status: Int, words: String) {
            #expect(BookRequestFlow.startFailure(APIError.http(status: status, message: "ignored")) == words)
        }

        @Test func fallsBackToThePlainFailureForAnErrorThatIsNotTheServers() {
            #expect(BookRequestFlow.startFailure(FakeFailure()) == "Couldn\u{2019}t start the request.")
        }

        @Test(arguments: [
            (BookRequestFlow.Action.choose, "Couldn\u{2019}t choose that version: boom"),
            (.cancel, "Couldn\u{2019}t cancel: boom"), (.undo, "Couldn\u{2019}t undo: boom"),
            (.swap, "Couldn\u{2019}t choose another: boom"), (.retry, "Couldn\u{2019}t try again: boom"),
            (.takeCover, "Couldn\u{2019}t use that cover: boom"), (.keepCover, "Couldn\u{2019}t keep this one: boom"),
        ])
        func wordsEachActionsFailureWithTheServersMessage(action: BookRequestFlow.Action, expected: String) {
            #expect(BookRequestFlow.actionFailure(action, error: APIError.http(status: 409, message: "boom")) == expected)
        }

        @Test func saysSomethingWentWrongForAnErrorThatIsNotTheServers() {
            #expect(BookRequestFlow.actionFailure(.cancel, error: FakeFailure()) == "Couldn\u{2019}t cancel: Something went wrong.")
        }
    }

    struct Gating {
        @Test func endsTheUndoToastASecondAndAHalfBeforeTheServerStopsTakingTheCancelBack() {
            #expect(BookRequestFlow.undoDelay(cancelAt: 110, now: at(100)) == .seconds(8.5))
        }

        @Test func neverGoesNegativeOnceTheGraceHasAllButGone() {
            #expect(BookRequestFlow.undoDelay(cancelAt: 101, now: at(100)) == .zero)
            #expect(BookRequestFlow.undoDelay(cancelAt: 90, now: at(100)) == .zero)
        }

        @Test func offersNoUndoWhenTheServerGaveNoCancelAt() {
            #expect(BookRequestFlow.undoDelay(cancelAt: nil, now: at(100)) == nil)
        }

        @Test(arguments: [
            (RequestState.looking, nil, true), (.choose, nil, true), (.chosen, nil, true), (.onItsWay, nil, true),
            (.onItsWay, 0.4, true), (.onItsWay, 1, false), (.ready, 1, false), (.stuck, nil, false),
            (.cancelled, nil, false),
        ] as [(RequestState, Double?, Bool)])
        func isCancellableWhileGoingUntilTheDownloadIsComplete(state: RequestState, progress: Double?, expected: Bool) {
            #expect(BookRequestFlow.isCancellable(aRequest(state: state, progress: progress)) == expected)
        }

        @Test func letsAChooserCancelAnyonesRequestAndAnAskerOnlyTheirOwn() {
            let theirs = aRequest(userID: 1)
            #expect(BookRequestFlow.canCancel(viewer: RequestViewer(id: 2, canStart: true, canChoose: true), request: theirs))
            #expect(BookRequestFlow.canCancel(viewer: RequestViewer(id: 1, canStart: true, canChoose: false), request: theirs))
            #expect(!BookRequestFlow.canCancel(viewer: RequestViewer(id: 2, canStart: true, canChoose: false), request: theirs))
        }

        @Test func turnsSearchSlowAtTwentySecondsAndStaleAtAHundredAndFifty() {
            #expect(!BookRequestFlow.isSearchSlow(updatedAt: 1000, now: at(1019)))
            #expect(BookRequestFlow.isSearchSlow(updatedAt: 1000, now: at(1020)))
            #expect(!BookRequestFlow.isSearchStale(updatedAt: 1000, now: at(1149)))
            #expect(BookRequestFlow.isSearchStale(updatedAt: 1000, now: at(1150)))
        }

        @Test func wordsTheLookingCardByHowLongTheSearchHasRun() {
            let search = aRequest(state: .looking, updatedAt: 1000)
            #expect(BookRequestFlow.lookingLabel(search, now: at(1019)) == "Looking for versions\u{2026}")
            #expect(BookRequestFlow.lookingLabel(search, now: at(1020)) == "Still searching for versions\u{2026}")
        }

        @Test func offersATryAgainOnAStaleSearchOnlyToAChooser() {
            let search = aRequest(state: .looking, updatedAt: 1000)
            let chooser = RequestViewer(id: 1, canStart: true, canChoose: true)
            #expect(BookRequestFlow.offersLookingRetry(search, viewer: chooser, now: at(1150)))
            #expect(!BookRequestFlow.offersLookingRetry(search, viewer: chooser, now: at(1149)))
            #expect(!BookRequestFlow.offersLookingRetry(search, viewer: ada, now: at(1150)))
        }

        @Test func holdsAKindWhenTheLibraryHasAFormatOfIt() {
            #expect(BookRequestFlow.holds(kind: .ebook, formats: ["EPUB"]))
            #expect(BookRequestFlow.holds(kind: .ebook, formats: ["pdf"]))
            #expect(!BookRequestFlow.holds(kind: .ebook, formats: ["M4B"]))
            #expect(!BookRequestFlow.holds(kind: .ebook, formats: ["PRINT"]))
            #expect(!BookRequestFlow.holds(kind: .ebook, formats: []))
            #expect(BookRequestFlow.holds(kind: .audiobook, formats: ["mp3"]))
            #expect(BookRequestFlow.holds(kind: .audiobook, formats: ["M4B"]))
            #expect(!BookRequestFlow.holds(kind: .audiobook, formats: ["EPUB", "PRINT"]))
        }

        @Test func offersEachKindTheLibraryLacksAndNoRequestCovers() {
            let kinds = BookRequestFlow.unrequestedKinds(formats: [], listings: [], viewer: ada)
            #expect(kinds == [.ebook, .audiobook])
            #expect(BookRequestFlow.unrequestedKinds(formats: ["EPUB"], listings: [], viewer: ada) == [.audiobook])
        }

        @Test func countsARequestInAnyStateAsCoveringItsKind() {
            let cancelled = [listing("b", kind: .ebook, state: .cancelled)]
            #expect(BookRequestFlow.unrequestedKinds(formats: [], listings: cancelled, viewer: ada) == [.audiobook])
        }

        @Test func offersNoKindToAReaderWhoCantStartRequests() {
            let viewer = RequestViewer(id: 1, canStart: false, canChoose: true)
            #expect(BookRequestFlow.unrequestedKinds(formats: [], listings: [], viewer: viewer).isEmpty)
        }

        @Test func pollsEveryTwoSecondsOnlyWhileAnyLaneIsMoving() {
            #expect(BookRequestFlow.detailPollInterval([aRequest(state: .ready), aRequest(id: 2, state: .looking)]) == .seconds(2))
            #expect(BookRequestFlow.detailPollInterval([aRequest(state: .choose), aRequest(id: 2, state: .stuck)]) == nil)
            #expect(BookRequestFlow.detailPollInterval([]) == nil)
        }

        @Test func movesWhileLookingChosenOrOnItsWayAndIsLiveAlsoWhileChoosing() {
            #expect(RequestState.allCases.filter(BookRequestFlow.isMoving) == [.looking, .chosen, .onItsWay])
            #expect(RequestState.allCases.filter(BookRequestFlow.isLive) == [.looking, .choose, .chosen, .onItsWay])
        }
    }

    struct RequestAgain {
        private let now = at(1_000)
        private let cancelled = aRequest(state: .cancelled, cancelAt: nil)

        @Test func offersItOnACancelledRequestOnceItsUndoHasRunOut() {
            #expect(BookRequestFlow.offersRequestAgain(cancelled, viewer: ada, bookRequests: [], now: now))
        }

        @Test func holdsItBackWhileTheUndoIsOpenAndOffersItAtTheEnd() {
            let open = aRequest(state: .cancelled, cancelAt: 1_001)
            let ending = aRequest(state: .cancelled, cancelAt: 1_000)
            #expect(!BookRequestFlow.offersRequestAgain(open, viewer: ada, bookRequests: [], now: now))
            #expect(BookRequestFlow.offersRequestAgain(ending, viewer: ada, bookRequests: [], now: now))
        }

        @Test func holdsItBackWhileTheViewerHasThatFormatRequestedAlready() {
            let live = aRequest(id: 2, userID: 1, kind: .ebook, state: .onItsWay)
            #expect(!BookRequestFlow.offersRequestAgain(cancelled, viewer: ada, bookRequests: [live], now: now))
        }

        @Test func offersItBesideAnotherReadersLiveRequestAndTheViewersOtherFormat() {
            let theirs = aRequest(id: 2, userID: 2, kind: .ebook, state: .looking)
            let audio = aRequest(id: 3, userID: 1, kind: .audiobook, state: .looking)
            #expect(BookRequestFlow.offersRequestAgain(cancelled, viewer: ada, bookRequests: [theirs], now: now))
            #expect(BookRequestFlow.offersRequestAgain(cancelled, viewer: ada, bookRequests: [audio], now: now))
        }

        @Test func holdsItBackFromAReaderWhoCantRequestAndOnARequestThatWasntCancelled() {
            let viewer = RequestViewer(id: 1, canStart: false, canChoose: true)
            #expect(!BookRequestFlow.offersRequestAgain(cancelled, viewer: viewer, bookRequests: [], now: now))
            let stuck = aRequest(state: .stuck)
            #expect(!BookRequestFlow.offersRequestAgain(stuck, viewer: ada, bookRequests: [], now: now))
        }
    }

    struct BookRequests {
        private func ids(_ found: [RequestListing]) -> [Int64] { found.map(\.request.id) }

        @Test func givesAnotherReadersLiveRequestALaneOfItsOwn() {
            let split = BookRequestFlow.splitBookRequests(
                [listing("b", id: 8, userID: 2, state: .choose), listing("b", id: 7)], shown: 7)
            #expect(ids(split.lanes) == [8])
            #expect(split.history.isEmpty)
        }

        @Test func keepsACancelledRequestInTheHistory() {
            let split = BookRequestFlow.splitBookRequests([listing("b", id: 5, state: .cancelled)], shown: 7)
            #expect(ids(split.history) == [5])
            #expect(split.lanes.isEmpty)
        }

        @Test func givesAStuckRequestALaneAndLeavesItOutOfTheHistory() {
            let split = BookRequestFlow.splitBookRequests(
                [listing("b", id: 4, state: .stuck, stuckReason: .notFound)], shown: 7)
            #expect(ids(split.lanes) == [4])
            #expect(split.history.isEmpty)
        }

        @Test func keepsARequestThatSwappedAVersionInTheHistory() {
            let swapped = aListing(
                aRequest(id: 3, state: .ready, chosenResultID: 11, versions: [aVersion(), aVersion(id: 12, rejected: true)]))
            #expect(ids(BookRequestFlow.splitBookRequests([swapped], shown: 7).history) == [3])
        }

        @Test func leavesAReadyRequestWithNothingSwappedAndTheRequestOnScreenOut() {
            let ready = listing("b", id: 3, state: .ready)
            #expect(BookRequestFlow.splitBookRequests([ready], shown: 7).history.isEmpty)
            let shown = listing("b", id: 7, state: .cancelled)
            let split = BookRequestFlow.splitBookRequests([shown], shown: 7)
            #expect(split.lanes.isEmpty && split.history.isEmpty)
        }

        @Test func choosesTheRequestTheListFilesTheBookUnder() {
            let listings = [listing("b", id: 3, userID: 2, state: .looking), listing("b", id: 2, state: .onItsWay), listing("b", id: 1, state: .cancelled)]
            #expect(BookRequestFlow.mainRequest(listings, viewer: ada)?.request.id == 2)
            #expect(BookRequestFlow.mainRequest([], viewer: ada) == nil)
        }
    }

    struct History {
        private let viewer: Int64 = 1
        private let utc = TimeZone(identifier: "UTC") ?? .gmt
        private let cancelledAt: Int64 = 1_791_846_000  // 2026-10-12 23:00 UTC
        private let epub = aVersion(id: 11, sizeBytes: 2_400_000)

        private func cancelled(by canceller: Int64?, name: String?, progress: Double? = 0.4, picked: Bool = true) -> RequestListing {
            aListing(
                aRequest(
                    state: .cancelled, chosenResultID: picked ? 11 : nil, updatedAt: cancelledAt,
                    progress: progress, cancelledBy: canceller, versions: picked ? [epub] : []),
                cancelledByName: name)
        }

        @Test func recordsWhoCancelledItAndTheDay() {
            #expect(
                BookRequestFlow.historyLine(cancelled(by: 1, name: "Ada"), viewer: viewer, timeZone: utc)
                    == "Ebook cancelled by you\(sep)Oct 12")
            #expect(
                BookRequestFlow.historyLine(cancelled(by: 2, name: "Jordan"), viewer: viewer, timeZone: utc)
                    == "Ebook cancelled by Jordan\(sep)Oct 12")
            #expect(
                BookRequestFlow.historyLine(cancelled(by: 9, name: nil), viewer: viewer, timeZone: utc)
                    == "Ebook cancelled\(sep)Oct 12")
        }

        @Test func headsANonCancelledRequestWithItsStateAndKind() {
            let ready = aListing(aRequest(kind: .audiobook, state: .ready, updatedAt: cancelledAt))
            #expect(BookRequestFlow.historyLine(ready, viewer: viewer, timeZone: utc) == "Audiobook ready to listen\(sep)Oct 12")
            let stuck = aListing(aRequest(state: .stuck, stuckReason: .stoppedMoving, updatedAt: cancelledAt))
            #expect(BookRequestFlow.historyLine(stuck, viewer: viewer, timeZone: utc) == "Ebook stopped moving\(sep)Oct 12")
        }

        @Test func detailsTheVersionAndHowFarItGot() {
            #expect(
                BookRequestFlow.historyDetails(cancelled(by: 1, name: nil))
                    == "EPUB\(sep)2.4\(nbsp)MB\(sep)stopped at 40%")
        }

        @Test func leavesOutWhereADownloadStoppedOnceItHadFinished() {
            let unfiled = aListing(
                aRequest(state: .stuck, stuckReason: .couldntAdd, chosenResultID: 11, progress: 1, versions: [epub]))
            #expect(BookRequestFlow.historyDetails(unfiled) == "EPUB\(sep)2.4\(nbsp)MB")
        }

        @Test func namesAnUnknownFormatAsUnknownAndOmitsDetailsForARequestWithNoVersion() {
            let blank = aVersion(id: 11, sizeBytes: nil, format: nil)
            let request = aListing(aRequest(state: .cancelled, chosenResultID: 11, progress: nil, versions: [blank]))
            #expect(BookRequestFlow.historyDetails(request) == "Unknown")
            #expect(BookRequestFlow.historyDetails(cancelled(by: 1, name: nil, progress: nil, picked: false)) == nil)
        }

        @Test func recordsEachVersionGivenUpAsSwappedForAnother() {
            let swapped = aListing(
                aRequest(state: .onItsWay, chosenResultID: 11, versions: [epub, aVersion(id: 12, sizeBytes: 9_100_000, format: "PDF", rejected: true)]))
            #expect(
                BookRequestFlow.swapFacts(swapped)
                    == [.init(id: 12, text: "Swapped for another version \u{b7} PDF \u{b7} 9.1\(nbsp)MB")])
        }

        @Test func namesTheDayOnTheReadersCalendarWithoutTheYear() {
            let lateOnOct12Utc: Int64 = 1_791_846_000
            #expect(BookRequestFlow.historyDay(lateOnOct12Utc, timeZone: utc) == "Oct 12")
            #expect(BookRequestFlow.historyDay(lateOnOct12Utc, timeZone: TimeZone(identifier: "Pacific/Kiritimati") ?? .gmt) == "Oct 13")
        }
    }

    struct Wording {
        private func wanter(_ id: Int64, _ name: String) -> WishlistWanter { WishlistWanter(id: id, name: name) }

        @Test func readsWhoWantsTheBookWithTheViewerAsYour() {
            #expect(BookRequestFlow.wishersLine([], viewer: 1) == nil)
            #expect(BookRequestFlow.wishersLine([wanter(1, "Ada")], viewer: 1) == "On your wishlist")
            #expect(BookRequestFlow.wishersLine([wanter(2, "Jordan")], viewer: 1) == "On Jordan\(apostrophe)s wishlist")
            #expect(
                BookRequestFlow.wishersLine([wanter(2, "Jordan"), wanter(1, "Ada")], viewer: 1)
                    == "On Jordan\(apostrophe)s and your wishlists")
            #expect(
                BookRequestFlow.wishersLine([wanter(2, "A"), wanter(3, "B"), wanter(4, "C")], viewer: 1)
                    == "On A\(apostrophe)s, B\(apostrophe)s and C\(apostrophe)s wishlists")
        }

        @Test func namesAKindAndItsChip() {
            #expect(BookRequestFlow.kindLabel(.ebook) == "Ebook")
            #expect(BookRequestFlow.kindLabel(.audiobook) == "Audiobook")
            #expect(BookRequestFlow.kindChip(.ebook) == "EPUB")
            #expect(BookRequestFlow.kindChip(.audiobook) == "M4B")
        }

        @Test func saysWhoAskedAndHowLongAgo() {
            let mine = aListing(aRequest(userID: 1, createdAt: 1_000), requesterName: "Ada")
            let theirs = aListing(aRequest(userID: 2, createdAt: 1_000 - 7_200), requesterName: "Jordan")
            #expect(BookRequestFlow.askedBy(mine, viewer: 1, now: at(1_000)) == "You \u{b7} just now")
            #expect(BookRequestFlow.askedBy(theirs, viewer: 1, now: at(1_000)) == "Jordan \u{b7} 2h ago")
        }
    }
}
