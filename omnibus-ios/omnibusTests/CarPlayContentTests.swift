//  CarPlayContentTests.swift
//  What the CarPlay screens show and offer.
//
//  CarPlay's templates can't be read back from a test, so these pin the
//  decisions they are built from: the speed the button steps to, which
//  chapters the list opens on, a Continue row's text, the Library list's
//  paging and re-reads, when a list redraws, whose rows the lists hold, Now
//  Playing's buttons, and the copy of the sheets and alerts.

import Testing

@testable import omnibus

private func point(
    position: Double = 1_200, total: Double? = 13_200, rate: Double? = nil,
    chapter: Int64? = nil, part: Int64? = nil
) -> ResumePoint {
    var record = ProgressRecord(
        bookUUID: "book-1", format: .audio, epubCFI: nil, audioPositionSeconds: position,
        updatedAt: 1_700_000_000, clientUpdatedAt: 1_700_000_000
    )
    record.totalDurationSeconds = total
    if let chapter {
        record.resolved = ResolvedPosition(chapterOrdinal: chapter, chaptersTotal: 40, confidence: .high)
    }
    var point = ResumePoint(
        record: record,
        book: Book(id: 1, filename: "book-1.m4b", title: "Book", uniqueIdentifier: "book-1", formats: ["m4b"]),
        audioPart: part, audioPartCount: part.map { _ in 4 }
    )
    point.playbackRate = rate
    return point
}

private func book(_ uuid: String) -> Book {
    Book(id: 1, filename: "\(uuid).m4b", title: uuid, uniqueIdentifier: uuid, formats: ["m4b"])
}

private func account(
    _ userID: Int64?, session: Int = 1, server: String = "https://a.example"
) -> CarPlayContent.Account {
    CarPlayContent.Account(server: server, userID: userID, session: session)
}

struct CarPlayContentTests {
    @Test func speedStepsUpThroughTheCarsPresetsAndWrapsToOne() {
        #expect(CarPlayContent.nextRate(after: 1.0) == 1.2)
        #expect(CarPlayContent.nextRate(after: 1.2) == 1.5)
        #expect(CarPlayContent.nextRate(after: 1.8) == 2.0)
        #expect(CarPlayContent.nextRate(after: 2.0) == 1.0)
    }

    @Test func speedOffThePresetsStepsToTheNextOneAbove() {
        // Set on the phone, where the presets are finer.
        #expect(CarPlayContent.nextRate(after: 1.35) == 1.5)
        #expect(CarPlayContent.nextRate(after: 0.8) == 1.0)
        #expect(CarPlayContent.nextRate(after: 2.5) == 1.0)
    }

    @Test func speedLabelIsThePlayersNotationWithoutFloatNoise() {
        #expect(Format.rate(1.0) == "1x")
        #expect(Format.rate(2.0) == "2x")
        #expect(Format.rate(1.2) == "1.2x")
        #expect(Format.rate(1.25) == "1.25x")
        // A rate stepped up in float arithmetic.
        #expect(Format.rate(1.0 + 0.1 + 0.1) == "1.2x")
    }

    @Test func chaptersListStartsOneBeforeTheCurrentChapter() {
        #expect(CarPlayContent.chapterWindow(count: 40, current: 24) == 23..<40)
    }

    @Test func chaptersListStartsAtTheTopInTheFirstChapterOrWithNoneKnown() {
        #expect(CarPlayContent.chapterWindow(count: 40, current: 0) == 0..<40)
        #expect(CarPlayContent.chapterWindow(count: 40, current: nil) == 0..<40)
        #expect(CarPlayContent.chapterWindow(count: 0, current: nil) == 0..<0)
    }

    @Test func continueRowNamesTheChapterAndTheTimeLeftAtTheBooksSpeed() {
        // 12,000 s left at 2x is 6,000 s of listening.
        let row = CarPlayContent.continueDetail(point(rate: 2.0, chapter: 12))
        #expect(row == "Chapter 12 · 1h 40m left")
    }

    @Test func continueRowNamesAPartWhenThereIsNoChapter() {
        #expect(CarPlayContent.continueDetail(point(part: 2)) == "Part 2 · 3h 20m left")
    }

    @Test func continueRowWithNothingKnownHasNoDetail() {
        #expect(CarPlayContent.continueDetail(point(total: nil)) == nil)
    }

    @Test func continueRowLeavesOutTimeLeftForAnEbookPosition() {
        var reading = point(chapter: 3)
        reading.record.format = .epub
        #expect(CarPlayContent.continueDetail(reading) == "Chapter 3")
    }

    @Test func libraryPageAppendsOnlyBooksNotAlreadyListed() {
        let listed = [book("a"), book("b")]
        // The mirror's fallback starts over from the top.
        let next = CarPlayContent.appending([book("a"), book("b"), book("c")], to: listed)
        #expect(next.map(\.uuid) == ["a", "b", "c"])
    }

    @Test func libraryPageDropsRepeatsWithinItself() {
        let next = CarPlayContent.appending([book("c"), book("c")], to: [book("a")])
        #expect(next.map(\.uuid) == ["a", "c"])
    }

    @Test func libraryFirstPageHoldsBackOnlyAnEmptyAnswerFromTheReplica() {
        // A fresh sign-in: the replica has nothing yet, and the server page is loading.
        #expect(!CarPlayContent.showsAtOnce([], isFresh: false))
        #expect(CarPlayContent.showsAtOnce([], isFresh: true))
        #expect(CarPlayContent.showsAtOnce([book("a")], isFresh: false))
        #expect(CarPlayContent.showsAtOnce([book("a")], isFresh: true))
    }

    @Test func continueHoldsBackOnlyAnEmptyAnswerFromTheReplica() {
        #expect(!CarPlayContent.showsAtOnce([] as [ResumePoint], isFresh: false))
        #expect(CarPlayContent.showsAtOnce([] as [ResumePoint], isFresh: true))
        #expect(CarPlayContent.showsAtOnce([point()], isFresh: false))
    }

    @Test func listRereadsOnlyWhenItHoldsNothingAndNothingIsLoading() {
        #expect(CarPlayContent.rereads(shown: nil as [Book]?, isReading: false))
        #expect(CarPlayContent.rereads(shown: [] as [Book], isReading: false))
        // A list on screen keeps its rows: a Library re-read pages through all of it.
        #expect(!CarPlayContent.rereads(shown: [book("a")], isReading: false))
        #expect(!CarPlayContent.rereads(shown: nil as [Book]?, isReading: true))
        #expect(!CarPlayContent.rereads(shown: [] as [Book], isReading: true))
    }

    @Test func listCutShortRereadsOverItsRowsButNeverOverARunningRead() {
        #expect(CarPlayContent.rereads(shown: [book("a")], isReading: false, cutShort: true))
        #expect(!CarPlayContent.rereads(shown: [book("a")], isReading: true, cutShort: true))
        #expect(!CarPlayContent.rereads(shown: nil as [Book]?, isReading: true, cutShort: true))
    }

    @Test func libraryPassReadsOnWhileAPageGainsAndThereIsAnother() {
        #expect(
            CarPlayContent.libraryPassStep(allFresh: true, gained: true, next: "c1", isFull: false) == .read("c1")
        )
        // The offline walk: the replica's first page, then the mirror's.
        #expect(
            CarPlayContent.libraryPassStep(allFresh: false, gained: true, next: "c1", isFull: false) == .read("c1")
        )
        #expect(
            CarPlayContent.libraryPassStep(allFresh: false, gained: true, next: "local:60", isFull: false)
                == .read("local:60")
        )
    }

    @Test func libraryPassPrunesOnlyWhenTheServerAnsweredEveryPageToTheEnd() {
        #expect(CarPlayContent.libraryPassStep(allFresh: true, gained: true, next: nil, isFull: false) == .finished)
        // At the cap with more to come, the rest wouldn't fit anyway.
        #expect(CarPlayContent.libraryPassStep(allFresh: true, gained: true, next: "c2", isFull: true) == .finished)
    }

    @Test func libraryPassPrunesOnAnEmptyTerminalPageFromTheServer() {
        // The rows past the last page were deleted, so it gains nothing and still ends the pass.
        #expect(CarPlayContent.libraryPassStep(allFresh: true, gained: false, next: nil, isFull: false) == .finished)
    }

    @Test func libraryPassNeverPrunesWhenTheServerMissedAPage() {
        // A 500 on the first page, its replica's cursor used, later pages fresh to the
        // end. And a one-page library the replica answered with the server down.
        #expect(CarPlayContent.libraryPassStep(allFresh: false, gained: true, next: nil, isFull: false) == .cutShort)
        // The mirror's repeat, or a fresh terminal page after a page the server missed.
        #expect(CarPlayContent.libraryPassStep(allFresh: false, gained: false, next: nil, isFull: false) == .cutShort)
    }

    @Test func libraryPassStopsAtAPageThatGainsNothingAndHasAnotherCursor() {
        // A repeating cursor never grows the list, so the cap would never stop it.
        #expect(CarPlayContent.libraryPassStep(allFresh: true, gained: false, next: "c2", isFull: false) == .cutShort)
        #expect(
            CarPlayContent.libraryPassStep(allFresh: false, gained: false, next: "local:60", isFull: false)
                == .cutShort
        )
    }

    @Test func libraryPassFromTheMirrorNeverPrunesAtTheCap() {
        #expect(
            CarPlayContent.libraryPassStep(allFresh: false, gained: true, next: "local:60", isFull: true) == .cutShort
        )
    }

    @Test func libraryFallbackLeavesRowsWhereTheyAre() {
        let shown = ["a", "b", "c", "d"].map(book)
        // A tied sort order: the mirror hands over `d` as though it came next.
        let rows = CarPlayContent.libraryRows(
            read: ["a", "b", "d"].map(book), shown: shown, keepingPlaces: true
        )
        #expect(rows.map(\.uuid) == ["a", "b", "c", "d"])
        #expect(
            CarPlayContent.libraryRows(read: ["a", "e"].map(book), shown: shown, keepingPlaces: true).map(\.uuid)
                == ["a", "b", "c", "d", "e"]
        )
        #expect(
            CarPlayContent.libraryRows(read: [book("a")], shown: nil, keepingPlaces: true).map(\.uuid) == ["a"]
        )
    }

    @Test func libraryFirstPageFromTheMirrorDoesNotUpdateRowsAlreadyShown() {
        // The replica wiped, the server unreachable: the mirror orders ties its own way.
        let shown = ["a", "b", "c"].map(book)
        let rows = CarPlayContent.libraryRows(read: ["b", "a"].map(book), shown: shown, keepingPlaces: true)
        #expect(!CarPlayContent.updatesSections(shown: shown.map(\.uuid), next: rows.map(\.uuid), isNewMessage: false))
    }

    @Test func aFailedReadSaysSoOnlyWhenNothingHasAnswered() {
        #expect(CarPlayContent.showsReadFailure(shown: nil as [Book]?))
        // The server said it's empty, and a failure doesn't take that back.
        #expect(!CarPlayContent.showsReadFailure(shown: [] as [Book]))
        #expect(!CarPlayContent.showsReadFailure(shown: [book("a")]))
    }

    @Test func listTheServerSaidIsEmptyKeepsItsMessageAndStillRereads() {
        #expect(!CarPlayContent.showsReadFailure(shown: [] as [Book]))
        #expect(CarPlayContent.rereads(shown: [] as [Book], isReading: false))
    }

    @Test func libraryPassKeepsTheRowsItHasNotReachedSoAnUnchangedListNeverChanges() {
        let shown = ["a", "b", "c", "d", "e", "f"].map(book)
        let uuids = shown.map(\.uuid)
        // Three pages of two, each answer as the pass has it so far.
        for read in 1...3 {
            let rows = CarPlayContent.libraryRows(read: Array(shown.prefix(read * 2)), shown: shown)
            #expect(rows.map(\.uuid) == uuids)
            #expect(!CarPlayContent.updatesSections(shown: uuids, next: rows.map(\.uuid), isNewMessage: false))
        }
    }

    @Test func libraryPassPutsANewBookAheadOfTheRowsItHasNotReached() {
        let rows = CarPlayContent.libraryRows(read: [book("new"), book("a")], shown: ["a", "b", "c"].map(book))
        #expect(rows.map(\.uuid) == ["new", "a", "b", "c"])
    }

    @Test func libraryPassWithNothingOnScreenIsJustWhatItRead() {
        #expect(CarPlayContent.libraryRows(read: [book("a")], shown: nil).map(\.uuid) == ["a"])
    }

    @Test func listUpdatesWhenItsRowsOrTheirOrderChange() {
        let shown = ["a", "b"]
        #expect(CarPlayContent.updatesSections(shown: shown, next: ["b", "a"], isNewMessage: false))
        #expect(CarPlayContent.updatesSections(shown: shown, next: ["a", "b", "c"], isNewMessage: false))
        #expect(CarPlayContent.updatesSections(shown: shown, next: ["a"], isNewMessage: false))
        #expect(CarPlayContent.updatesSections(shown: shown, next: [], isNewMessage: false))
        #expect(CarPlayContent.updatesSections(shown: [], next: shown, isNewMessage: false))
    }

    @Test func listKeepsItsPlaceWhenItsRowsAreTheSame() {
        #expect(!CarPlayContent.updatesSections(shown: ["a", "b"], next: ["a", "b"], isNewMessage: false))
        // A message behind rows isn't on screen.
        #expect(!CarPlayContent.updatesSections(shown: ["a", "b"], next: ["a", "b"], isNewMessage: true))
        #expect(!CarPlayContent.updatesSections(shown: [], next: [], isNewMessage: false))
    }

    @Test func emptyListUpdatesToDrawANewMessage() {
        #expect(CarPlayContent.updatesSections(shown: [], next: [], isNewMessage: true))
    }

    @Test func accountForgetsNothingWhenTheSameSessionLearnsItsUserID() {
        let unknown = account(nil)
        let known = account(1)
        #expect(CarPlayContent.sameAccount(held: unknown, signedIn: known) == known)
        #expect(CarPlayContent.sameAccount(held: known, signedIn: known) == known)
        #expect(CarPlayContent.sameAccount(held: unknown, signedIn: unknown) == unknown)
    }

    @Test func accountKeepsTheIDItKnowsWhenTheCachedUserGoesAway() {
        // Saving a Kindle email deletes the cached `me`.
        let unknown = account(nil)
        let known = account(1)
        let held = CarPlayContent.sameAccount(held: known, signedIn: unknown)
        #expect(held == known)
        // So another user after that still reads as another user.
        #expect(CarPlayContent.sameAccount(held: held, signedIn: account(2)) == nil)
    }

    @Test func accountIsForgottenForAnotherSessionWhenItsUserIDIsUnknown() {
        // A token that outlived its `me`, then someone signing in on the phone.
        let held = account(nil, session: 1)
        #expect(CarPlayContent.sameAccount(held: held, signedIn: account(2, session: 2)) == nil)
        #expect(CarPlayContent.sameAccount(held: held, signedIn: account(nil, session: 2)) == nil)
        #expect(CarPlayContent.sameAccount(held: account(1), signedIn: account(nil, session: 2)) == nil)
    }

    @Test func accountSurvivesANewTokenForTheSameKnownUser() {
        let renewed = account(1, session: 2)
        #expect(CarPlayContent.sameAccount(held: account(1), signedIn: renewed) == renewed)
    }

    @Test func sessionGenerationMovesWhenTheTokensValueChangesAndNotAtLaunch() {
        // What a launch does, and a car connecting after it sees no new session.
        var session = TokenSession(token: "token-one")
        let atLaunch = session.generation
        #expect(atLaunch == 0)
        session.token = "token-one"
        #expect(session.generation == atLaunch)
        session.token = "token-two"
        let second = session.generation
        #expect(second != nil && second != atLaunch)
        session.token = nil
        #expect(session.generation == nil)
        session.token = "token-one"
        let third = session.generation
        #expect(third != nil && third != atLaunch && third != second)
    }

    @Test func accountIsForgottenForAnotherKnownUserOrAnotherServer() {
        let held = account(1)
        #expect(CarPlayContent.sameAccount(held: held, signedIn: account(2)) == nil)
        #expect(CarPlayContent.sameAccount(held: held, signedIn: account(1, server: "https://b.example")) == nil)
        #expect(
            CarPlayContent.sameAccount(held: account(nil), signedIn: account(nil, server: "https://b.example")) == nil
        )
    }

    @Test func accountHeldByNoOneIsNeverTheSame() {
        #expect(CarPlayContent.sameAccount(held: nil, signedIn: account(1)) == nil)
    }

    @Test func failedReadDoesNotClaimAListIsEmpty() {
        #expect(CarPlayContent.readFailed != CarPlayContent.nothingInProgress)
        #expect(CarPlayContent.readFailed != CarPlayContent.noAudiobooks)
    }

    @Test func loadFailureAlertSaysWhyThenFallsBackToAShortTitle() {
        #expect(
            CarPlayContent.loadFailed("Server unreachable.")
                == ["Couldn't play this book. Server unreachable.", "Couldn't play this book"]
        )
    }

    @Test func nowPlayingOffersChapterButtonsOnlyForABookWithChapters() {
        #expect(
            CarPlayContent.nowPlayingButtons(hasChapters: true)
                == [.rate, .bookmark, .previousChapter, .nextChapter]
        )
        #expect(CarPlayContent.nowPlayingButtons(hasChapters: false) == [.rate, .bookmark])
    }

    @Test func offersNameWhereTheJumpGoes() {
        #expect(CarPlayContent.syncOffer(at: 15_125).jump == "Jump to 4:12:05")
        #expect(
            CarPlayContent.crossFormatOffer(at: 600, ahead: true).title == "Read further in the ebook"
        )
        // A backward offer must not claim "further".
        #expect(
            CarPlayContent.crossFormatOffer(at: 600, ahead: false).title
                == "Re-reading earlier in the ebook"
        )
    }
}
