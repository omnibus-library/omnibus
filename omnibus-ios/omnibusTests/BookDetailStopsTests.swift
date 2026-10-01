//  BookDetailStopsTests.swift
//  The pure derivations behind the detail marquee's stops: the Home kicker,
//  the Resume label, the ruler fraction, the stats fold, and the caps the
//  Highlights and Journals stops apply before handing off to a sheet.

import Foundation
import Testing

@testable import omnibus

// MARK: - Kicker

@Test func kickerNamesSeriesBookAndYear() {
    let line = DetailRead.kicker(
        series: "Kingkiller Chronicle", seriesIndex: "1", fallback: "Fantasy", year: "2007"
    )
    #expect(line == "Kingkiller Chronicle · Book 1 · 2007")
}

@Test func kickerFallsBackToCategoryForStandalones() {
    let line = DetailRead.kicker(
        series: nil, seriesIndex: nil, fallback: "Fantasy", year: "2018"
    )
    #expect(line == "Fantasy · standalone · 2018")
}

@Test func kickerSurvivesABareRecord() {
    // Worded as the web's `home_kicker` does: never "In your library", which
    // a wishlist-only or just-removed record is not.
    let line = DetailRead.kicker(series: nil, seriesIndex: nil, fallback: nil, year: nil)
    #expect(line == "Book · standalone")
}

@Test func kickerNamesTheWishlistForAWishlistOnlyBook() {
    let line = DetailRead.kicker(
        series: "Dune", seriesIndex: "1", fallback: nil, year: "1965",
        wishlistSource: "a scan"
    )
    #expect(line == "On your wishlist · added from a scan")
}

// MARK: - Fileless records

@Test func readStatusIsOfferedOnlyForSomethingToRead() {
    #expect(DetailRead.showsReadStatus(hasFile: true, hasPhysical: false))
    #expect(DetailRead.showsReadStatus(hasFile: false, hasPhysical: true))
    #expect(!DetailRead.showsReadStatus(hasFile: false, hasPhysical: false))
}

@Test func removingTheWishlistEntryLeavesAPageWithNothingLeftToShow() {
    #expect(DetailRead.leavesAfterWishlistRemoval(bookDeleted: true, hasFile: false, hasPhysical: false))
    // Kept because another reader still wants it, but unreachable from browse.
    #expect(DetailRead.leavesAfterWishlistRemoval(bookDeleted: false, hasFile: false, hasPhysical: false))
    #expect(!DetailRead.leavesAfterWishlistRemoval(bookDeleted: false, hasFile: false, hasPhysical: true))
    #expect(!DetailRead.leavesAfterWishlistRemoval(bookDeleted: false, hasFile: true, hasPhysical: false))
}

@Test func emptyStatsOnlyAskAReaderToOpenABookThatHasAFile() {
    let open = "Open the book to start tracking your reading here."
    #expect(
        DetailStats.emptyExplainer(
            hasPosition: false, wishlistOnly: false, hasFile: true, hasPhysical: false
        ) == open
    )
    for (wishlist, physical) in [(true, false), (false, true), (false, false)] {
        let line = DetailStats.emptyExplainer(
            hasPosition: false, wishlistOnly: wishlist, hasFile: false, hasPhysical: physical
        )
        #expect(!line.localizedCaseInsensitiveContains("open the book"))
    }
}

@Test func emptyStatsAgreeWithHomeThatAPositionMeansStarted() {
    // Home reads "in progress" off the saved position; the session log trails
    // it, so an empty log beside a position is underway, not "not begun".
    #expect(DetailStats.emptyKicker(hasPosition: true) == "This read · underway")
    #expect(DetailStats.emptyKicker(hasPosition: false) == "This read · not begun")
    let line = DetailStats.emptyExplainer(
        hasPosition: true, wishlistOnly: false, hasFile: true, hasPhysical: false
    )
    #expect(!line.localizedCaseInsensitiveContains("open the book"))
}

// MARK: - Language

@Test func languageNamesTheCodeRatherThanPrintingIt() {
    #expect(Format.language("en") == "English")
    #expect(Format.language("eng") == "English")
    #expect(Format.language("en-US") == "English")
    #expect(Format.language("pt_BR") == "Portuguese")
}

@Test func languageFilesCodesThatDeclineToAnswerAsUnknown() {
    // The same bucket the stats composition breakdown uses for them.
    for code in ["und", "UND", "mul", "zxx", "mis", "und-Latn"] {
        #expect(Format.language(code) == "Unknown")
    }
    #expect(Format.language(nil) == nil)
    #expect(Format.language("  ") == nil)
    #expect(Format.language("qaa") == "QAA")
}

// MARK: - Resume label

@Test func resumeLabelSpeaksTheEbookPercentWhenOneIsSaved() {
    let label = DetailRead.resumeLabel(
        hasEbook: true, hasAudiobook: true, epubStarted: true,
        epubPercent: 55, audioSeconds: nil
    )
    #expect(label == "Resume — 55%")
}

@Test func resumeLabelSaysReadWhenNothingIsSaved() {
    let label = DetailRead.resumeLabel(
        hasEbook: true, hasAudiobook: false, epubStarted: false,
        epubPercent: nil, audioSeconds: nil
    )
    #expect(label == "Read")
}

@Test func resumeLabelSpeaksTheAudioPositionWhenOnlyListeningHasStarted() {
    // The dual-format case: reading never started, listening did.
    let label = DetailRead.resumeLabel(
        hasEbook: true, hasAudiobook: true, epubStarted: false,
        epubPercent: nil, audioSeconds: 55_260
    )
    #expect(label == "Resume — 15h 21m")
}

@Test func resumeLabelIsABareResumeForACFIOnlySave() {
    let label = DetailRead.resumeLabel(
        hasEbook: true, hasAudiobook: true, epubStarted: true,
        epubPercent: nil, audioSeconds: 55_260
    )
    #expect(label == "Resume")
}

@Test func resumeLabelSpeaksTheAudioPositionForAudioOnlyBooks() {
    let label = DetailRead.resumeLabel(
        hasEbook: false, hasAudiobook: true, epubStarted: false,
        epubPercent: nil, audioSeconds: 55_260
    )
    #expect(label == "Resume — 15h 21m")
}

@Test func resumeLabelSaysListenForAnUnstartedAudiobook() {
    let label = DetailRead.resumeLabel(
        hasEbook: false, hasAudiobook: true, epubStarted: false,
        epubPercent: nil, audioSeconds: 0
    )
    #expect(label == "Listen")
}

// MARK: - Resume destination

@Test func resumeOpensThePlayerWhenOnlyListeningHasStarted() {
    #expect(DetailRead.resumesIntoPlayer(
        hasEbook: true, hasAudiobook: true, epubStarted: false, audioSeconds: 900
    ))
}

@Test func resumeOpensTheReaderOnceReadingHasStarted() {
    #expect(!DetailRead.resumesIntoPlayer(
        hasEbook: true, hasAudiobook: true, epubStarted: true, audioSeconds: 900
    ))
}

@Test func resumeOpensTheReaderForAnUnstartedDualFormatBook() {
    #expect(!DetailRead.resumesIntoPlayer(
        hasEbook: true, hasAudiobook: true, epubStarted: false, audioSeconds: nil
    ))
}

@Test func resumeOpensThePlayerForAudioOnlyBooks() {
    #expect(DetailRead.resumesIntoPlayer(
        hasEbook: false, hasAudiobook: true, epubStarted: false, audioSeconds: nil
    ))
}

// MARK: - Ruler fraction

@Test func fractionComesFromTheEbookPercentWhenTheBookHasOne() {
    let fraction = DetailRead.fraction(
        epubStarted: true, epubPercent: 55, audioSeconds: nil, audioDuration: nil
    )
    #expect(fraction == 0.55)
}

@Test func fractionIsNilWhenACFIOnlySaveCarriesNoPercent() {
    // Reading is underway; the (older) audio position must not misplace it.
    let fraction = DetailRead.fraction(
        epubStarted: true, epubPercent: nil, audioSeconds: 120, audioDuration: 240
    )
    #expect(fraction == nil)
}

@Test func fractionFallsBackToAudioWhenReadingNeverStarted() {
    let fraction = DetailRead.fraction(
        epubStarted: false, epubPercent: nil, audioSeconds: 90, audioDuration: 360
    )
    #expect(fraction == 0.25)
}

@Test func fractionIsNilWhenAudioDurationIsUnknown() {
    let fraction = DetailRead.fraction(
        epubStarted: false, epubPercent: nil, audioSeconds: 90, audioDuration: nil
    )
    #expect(fraction == nil)
}

// MARK: - Stats fold

private func sitting(
    start: Int64, seconds: Int64, format: SessionFormat = .reading
) -> SessionLogEntry {
    SessionLogEntry(
        bookUUID: "b", title: "Book", format: format,
        startedAt: start, endedAt: start + seconds, seconds: seconds
    )
}

@Test func statsRecordFoldsTheSessionLog() {
    let now = Date(timeIntervalSince1970: 1_000_000)
    let record = DetailStats.record(
        from: [
            sitting(start: 900_000, seconds: 600),
            sitting(start: 100_000, seconds: 1_800),
            sitting(start: 500_000, seconds: 1_200, format: .listening),
        ],
        now: now
    )

    #expect(record?.startedAt == 100_000)
    #expect(record?.daysIn == 10)
    #expect(record?.totalSeconds == 3_600)
    #expect(record?.sessions == 3)
    #expect(record?.averageSeconds == 1_200)
    #expect(record?.longestSeconds == 1_800)
    #expect(record?.longestAt == 100_000)
    #expect(record?.readSeconds == 2_400)
    #expect(record?.listenSeconds == 1_200)
}

@Test func statsRecordIsNilWithNoSittings() {
    #expect(DetailStats.record(from: []) == nil)
}

@Test func sparkMinutesBucketsByCalendarDayOldestFirst() {
    // A fixed calendar so the day boundaries don't move with the test host.
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!

    let now = Date(timeIntervalSince1970: 2_000_000)  // Jan 24 1970, 03:33 UTC
    let minutes = DetailStats.sparkMinutes(
        from: [
            // 30 minutes today, 10 minutes the previous calendar day —
            // late-evening Jan 23, which a trailing-24h window would misfile
            // as "today" — and one sitting far too old.
            sitting(start: 1_999_000, seconds: 1_800),
            sitting(start: 1_978_000, seconds: 600),
            sitting(start: 100, seconds: 6_000),
        ],
        days: 21,
        now: now,
        calendar: calendar
    )

    #expect(minutes.count == 21)
    #expect(minutes[20] == 30)
    #expect(minutes[19] == 10)
    #expect(minutes.reduce(0, +) == 40)
}

// MARK: - Stop caps

@Test func highlightsStopPreviewsTheNewestFour() {
    let highlights = (1...9).map { index in
        Highlight(
            id: Int64(index), bookUUID: "b", epubCFIRange: nil, color: .amber,
            note: nil, text: "line \(index)", clientID: nil, createdAt: Int64(index)
        )
    }
    let preview = StopHighlights.preview(of: highlights)

    #expect(preview.count == StopHighlights.stopCount)
    #expect(preview.map(\.id) == [9, 8, 7, 6])
}

@Test func highlightsStopPreviewKeepsAShortListWhole() {
    let highlights = [
        Highlight(
            id: 1, bookUUID: "b", epubCFIRange: nil, color: .amber,
            note: nil, text: "line", clientID: nil, createdAt: 5
        )
    ]
    #expect(StopHighlights.preview(of: highlights).count == 1)
}

@Test func highlightRowQuotesOnlyRowsThatCarryAPassage() {
    func row(text: String?) -> Highlight {
        Highlight(
            id: 1, bookUUID: "b", epubCFIRange: nil, color: .amber,
            note: "a note", text: text, clientID: nil, createdAt: 5
        )
    }

    #expect(HighlightRow.quotable(row(text: "A kept line")) == "A kept line")
    // A Kobo-origin row can list with no passage; a note alone is no card.
    #expect(HighlightRow.quotable(row(text: nil)) == nil)
    #expect(HighlightRow.quotable(row(text: "  \n ")) == nil)
}

@Test func journalRowPreviewStripsMarkdownFromTheOpeningLine() {
    let preview = JournalRow.preview("**Kvothe** is an *unreliable* narrator\n\nSecond para")
    #expect(preview == "Kvothe is an unreliable narrator")
}

@Test func journalRowPreviewKeepsProseCharactersThatLookLikeSyntax() {
    let preview = JournalRow.preview("Wrote a C# parser in snake_case style")
    #expect(preview == "Wrote a C# parser in snake_case style")
}

@Test func journalRowPreviewUnwrapsAListMarker() {
    let preview = JournalRow.preview("- The Cinder scene lands differently in audio")
    #expect(preview == "The Cinder scene lands differently in audio")
}

@Test func journalRowPreviewUnwrapsANumberedOrQuotedOpeningLine() {
    #expect(JournalRow.preview("1. Started it again") == "Started it again")
    #expect(JournalRow.preview("> The Beauty of the House") == "The Beauty of the House")
    // Prose that merely opens with a year keeps its digits — the marker needs
    // its `.` or `)`.
    #expect(JournalRow.preview("1984 reads differently now") == "1984 reads differently now")
}

@Test func journalRowPreviewCensorsASpoilerSoTheRowCannotLeakIt() {
    // The row is always visible, so the span never reaches it in the clear.
    let preview = JournalRow.preview("Cannot believe ||Fitchner was **ARES**|| honestly")
    #expect(preview == "Cannot believe \u{2588}\u{2588}\u{2588} honestly")
}

// MARK: - Journal kicker

private func journalEntry(
    author: Int64, status: JournalStatus = .published
) -> JournalEntry {
    JournalEntry(
        id: author, bookUUID: "b", authorId: author, authorName: "r\(author)",
        bodyMd: "body", bodyHtml: "<p>body</p>", progress: nil, status: status,
        clientID: nil, createdAt: 0, updatedAt: 0
    )
}

/// The wording here is a mirror of `marquee_journal_kicker` in
/// `frontend/src/pages/book_detail/journal.rs`; these cases are the web
/// suite's, so a change to one client that isn't made to the other fails here.
@Test func journalKickerCountsEntriesAndReaders() {
    #expect(DetailJournal.kicker([journalEntry(author: 1)]) == "1 entry from 1 reader")
    #expect(
        DetailJournal.kicker(
            [journalEntry(author: 1), journalEntry(author: 2), journalEntry(author: 2)]
        ) == "3 entries from 2 readers"
    )
}

@Test func journalKickerAppendsDraftsApartFromThePublishedTotal() {
    // A draft is visible only to its own author, so it is reported beside the
    // published count rather than folded into it.
    let entries = [
        journalEntry(author: 1),
        journalEntry(author: 1, status: .draft),
    ]
    #expect(DetailJournal.kicker(entries) == "1 entry from 1 reader · 1 draft")
}

@Test func journalKickerReportsTheEmptyFeedWithoutCounts() {
    #expect(DetailJournal.kicker([]) == "No entries yet")
}

@Test func journalBylineMarksOnlyTheViewersOwnEntries() {
    #expect(DetailJournal.isOwn(journalEntry(author: 3), viewerId: 3))
    #expect(!DetailJournal.isOwn(journalEntry(author: 3), viewerId: 4))
    // Not yet signed in: nothing is "you", including an optimistic row whose
    // author fell back to 0.
    #expect(!DetailJournal.isOwn(journalEntry(author: 0), viewerId: nil))
}

// MARK: - Creators

@Test func everyLinkedCreatorGetsItsOwnAuthorPage() {
    let creators = [
        Contributor(name: "Frank Herbert", id: 1),
        Contributor(name: "John Schoenherr", role: "ill", id: 2),
        Contributor(name: "Unlinked Editor"),
        Contributor(name: "Frank Herbert", role: "aut", id: 1),
    ]
    #expect(DetailRead.linkedCreators(creators) == [
        DetailCreatorLink(id: 1, name: "Frank Herbert"),
        DetailCreatorLink(id: 2, name: "John Schoenherr"),
    ])
}

// MARK: - Rating

@Test func tappingTheRatingAlreadySetClearsIt() {
    #expect(StarRating.committed(4, current: 4, isTap: true) == 0)
    // A drag that happens to end on the set value is an adjustment.
    #expect(StarRating.committed(4, current: 4, isTap: false) == 4)
    #expect(StarRating.committed(3.5, current: 4, isTap: true) == 3.5)
    #expect(StarRating.committed(2, current: 0, isTap: true) == 2)
}

// MARK: - Journal composer target

private func entry(id: Int64, clientID: String? = nil) -> JournalEntry {
    JournalEntry(
        id: id, bookUUID: "b", authorId: 1, authorName: "admin",
        bodyMd: "body", bodyHtml: "<p>body</p>", progress: nil,
        clientID: clientID, createdAt: 0, updatedAt: 0
    )
}

@Test func composerTargetCarriesTheEntryItWasOpenedOn() {
    // The regression this type exists for: Edit lost its entry when the
    // composer was a Bool with the entry in a separate `@State` beside it.
    let target = BookDetailView.ComposerTarget.editing(entry(id: 7))
    #expect(target.entry?.id == 7)
    #expect(BookDetailView.ComposerTarget.new.entry == nil)
}

@Test func composerTargetIdentitySeparatesNewFromEachEditedEntry() {
    // The id is what `.sheet(item:)` re-presents on, so two entries must not
    // share one — and neither may collide with a new entry.
    let first = BookDetailView.ComposerTarget.editing(entry(id: 7))
    let second = BookDetailView.ComposerTarget.editing(entry(id: 8))
    #expect(first.id != second.id)
    #expect(first.id != BookDetailView.ComposerTarget.new.id)
}

@Test func composerTargetIdentityFollowsAnOfflineEntrysClientID() {
    // An entry created offline has no server id yet; its client-minted handle
    // is what distinguishes it (migration 0051's whole point).
    let pending = BookDetailView.ComposerTarget.editing(entry(id: 0, clientID: "abc"))
    #expect(pending.id == "abc")
}


// MARK: - Two-position Home geometry

@Test func restTopSitsUnderAWholeCoverOnAPhone() {
    #expect(DetailRead.restTop(width: 402, height: 874) == 603)
}

@Test func restTopYieldsToAShortScreenSoThePanelKeepsItsStrip() {
    // A 375pt-wide cover runs 562pt tall; a 700pt screen caps the rest
    // position so the panel keeps its 240pt strip.
    #expect(DetailRead.restTop(width: 375, height: 700) == 460)
}

@Test func restTopKeepsAFloorOfArtOnADegenerateScreen() {
    #expect(DetailRead.restTop(width: 800, height: 400) == 220)
}

@Test func scrollMapLiftsAcrossTheRestRunBeforeAnyPageTurns() {
    let mid = DetailRead.scrollMap(offset: 300, restTop: 600, viewport: 874)
    #expect(abs(mid.lift - 0.5) < 0.001)
    #expect(mid.page == 0)

    let lifted = DetailRead.scrollMap(offset: 600, restTop: 600, viewport: 874)
    #expect(lifted.lift == 1)
    #expect(lifted.page == 0)
}

@Test func scrollMapCountsPagesPastTheRestRun() {
    let map = DetailRead.scrollMap(offset: 600 + 874 * 2, restTop: 600, viewport: 874)
    #expect(map.lift == 1)
    #expect(abs(map.page - 2) < 0.001)
}

@Test func scrollMapDegeneratesToPlainPagingWithoutARestRun() {
    let map = DetailRead.scrollMap(offset: 874, restTop: 0, viewport: 874)
    #expect(map.lift == 1)
    #expect(abs(map.page - 1) < 0.001)
}

// MARK: - Home sync row

@Test func syncRowInvitesALinkWhileFormatsAreNotLinked() {
    let copy = DetailSyncCopy(label: "Positions unlinked", action: "Link", linked: false)
    #expect(DetailRead.syncRow(state: .notLinked) == copy)
    // No answer yet (offline, or the fetch hasn't landed) reads the same —
    // the sheet it opens states the truth either way.
    #expect(DetailRead.syncRow(state: nil) == copy)
}

@Test func syncRowAsksForAReconfirmWhenTheLinkWentStale() {
    #expect(DetailRead.syncRow(state: .linkStale)
        == DetailSyncCopy(label: "Sync needs re-confirm", action: "Re-confirm", linked: false))
}

@Test func syncRowStatesLinkedForEveryLinkedState() {
    let linked = DetailSyncCopy(label: "Positions linked", action: "Manage", linked: true)
    #expect(DetailRead.syncRow(state: .aligned) == linked)
    #expect(DetailRead.syncRow(state: .candidate) == linked)
    #expect(DetailRead.syncRow(state: .nothingNewer) == linked)
}

// MARK: - Section list

/// Both clients agreed on this six-section list (web folded its Shelf stop
/// the same way) — pinning it keeps the numbering from drifting apart.
@Test func detailStopsRunHomeToMoreInSixSections() {
    #expect(DetailStop.allCases.map(\.name)
        == ["Home", "Stats", "Highlights", "Journals", "The files", "More"])
}
