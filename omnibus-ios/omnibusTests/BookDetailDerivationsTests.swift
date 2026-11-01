//  BookDetailDerivationsTests.swift
//  The pure derivations behind the book page: fileless records, the language
//  names, the primary action, the progress bar, the Your reading card, kept
//  lines and journal previews, the journal composer's target, and where the
//  finish card points, who sees which row of the More menu, and how a bookmark
//  and an export describe themselves.

import Foundation
import Testing

@testable import omnibus

// MARK: - Fileless records

@Test func wishlistLineSaysWhereTheEntryCameFrom() {
    #expect(DetailRead.wishlistLine(source: "a scan") == "On your wishlist · added from a scan")
}

@Test func readStatusIsOfferedOnlyForSomethingToRead() {
    #expect(DetailRead.showsReadStatus(hasFile: true, hasPhysical: false, wishlisted: false))
    #expect(DetailRead.showsReadStatus(hasFile: false, hasPhysical: true, wishlisted: false))
    // You may already have read a book you're hunting a copy of.
    #expect(DetailRead.showsReadStatus(hasFile: false, hasPhysical: false, wishlisted: true))
    #expect(!DetailRead.showsReadStatus(hasFile: false, hasPhysical: false, wishlisted: false))
}

@Test func removingTheWishlistEntryLeavesAPageWithNothingLeftToShow() {
    #expect(DetailRead.leavesAfterWishlistRemoval(bookDeleted: true, hasFile: false, hasPhysical: false))
    // Kept because another reader still wants it, but unreachable from browse.
    #expect(DetailRead.leavesAfterWishlistRemoval(bookDeleted: false, hasFile: false, hasPhysical: false))
    #expect(!DetailRead.leavesAfterWishlistRemoval(bookDeleted: false, hasFile: false, hasPhysical: true))
    #expect(!DetailRead.leavesAfterWishlistRemoval(bookDeleted: false, hasFile: true, hasPhysical: false))
}

private func readingLine(
    status: ReadStatus = .unread, wishlistOnly: Bool = false, hasFile: Bool = false,
    hasPhysical: Bool = false, hasPosition: Bool = false, record: DetailReadRecord? = nil,
    finishedAt: Int64? = nil
) -> String {
    DetailStats.readingLine(
        status: status, wishlistOnly: wishlistOnly, hasFile: hasFile, hasPhysical: hasPhysical,
        hasPosition: hasPosition, record: record, finishedAt: finishedAt
    )
}

@Test func readingCardOnlyAsksAReaderToOpenABookThatHasAFile() {
    #expect(readingLine(hasFile: true).localizedCaseInsensitiveContains("open the book"))
    #expect(!readingLine(wishlistOnly: true).localizedCaseInsensitiveContains("open the book"))
    #expect(!readingLine(hasPhysical: true).localizedCaseInsensitiveContains("open the book"))
    #expect(!readingLine().localizedCaseInsensitiveContains("open the book"))
}

@Test func readingCardAgreesWithTheStageThatAPositionMeansStarted() {
    // The stage reads "in progress" off the saved position; the session log
    // trails it, so an empty log beside a position is underway, not unbegun.
    let line = readingLine(hasFile: true, hasPosition: true)
    #expect(line == "Sittings of a minute or more show here once they sync.")
}

@Test func readingCardSaysWhenItStartedAndWhenItFinished() {
    let record = DetailStats.record(
        from: [sitting(start: 100_000, seconds: 600)], now: Date(timeIntervalSince1970: 200_000)
    )
    #expect(readingLine(status: .reading, hasFile: true, record: record).hasPrefix("Reading since "))
    #expect(
        readingLine(status: .finished, hasFile: true, record: record, finishedAt: 150_000)
            .hasPrefix("Finished ")
    )
    // No date on record: the page falls back rather than inventing one.
    #expect(readingLine(status: .finished, hasFile: true, record: record).hasPrefix("Reading since "))
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

// MARK: - Primary action

@Test func actionSaysStartUntilThereIsAPlaceToContinueFrom() {
    #expect(
        DetailRead.actionLabel(status: .unread, hasPosition: false, toPlayer: false, chapter: nil)
            == "Start reading"
    )
    #expect(
        DetailRead.actionLabel(status: .unread, hasPosition: false, toPlayer: true, chapter: nil)
            == "Start listening"
    )
}

@Test func actionContinuesFromAPlaceEvenIfTheStatusSaysUnread() {
    // A reader who marked a started book unread still opens at their place.
    #expect(
        DetailRead.actionLabel(status: .unread, hasPosition: true, toPlayer: false, chapter: nil)
            == "Continue reading"
    )
}

@Test func actionNamesTheChapterOnceTheServerHasPlacedIt() {
    #expect(
        DetailRead.actionLabel(status: .reading, hasPosition: true, toPlayer: false, chapter: 6)
            == "Continue · Chapter 6"
    )
    #expect(
        DetailRead.actionLabel(status: .reading, hasPosition: true, toPlayer: true, chapter: 6)
            == "Continue listening"
    )
}

@Test func actionOffersAnotherGoAtAFinishedBook() {
    #expect(
        DetailRead.actionLabel(status: .finished, hasPosition: true, toPlayer: false, chapter: 6)
            == "Read again"
    )
    #expect(
        DetailRead.actionLabel(status: .finished, hasPosition: true, toPlayer: true, chapter: nil)
            == "Listen again"
    )
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

// MARK: - Bar fraction

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

// MARK: - Your reading

@Test func paceAndTimeLeftComeFromTheTimeSpentSoFar() {
    let record = DetailStats.record(
        from: [sitting(start: 100, seconds: 3_600)], now: Date(timeIntervalSince1970: 86_500)
    )
    #expect(DetailStats.secondsLeft(record: record, percent: 25) == 10_800)
    #expect(
        DetailStats.leftLine(
            record: record, percent: 25, isAudio: false, audioSeconds: nil, audioDuration: nil
        ) == "about 3 h 00 m left at your pace"
    )
    // Nothing to go on at either end, and no record means no pace.
    #expect(DetailStats.secondsLeft(record: record, percent: 0) == nil)
    #expect(DetailStats.secondsLeft(record: record, percent: 100) == nil)
    #expect(DetailStats.secondsLeft(record: nil, percent: 25) == nil)
}

@Test func listeningLeftIsMeasuredAgainstTheAudiobook() {
    #expect(
        DetailStats.leftLine(
            record: nil, percent: 50, isAudio: true, audioSeconds: 3_600, audioDuration: 7_200
        ) == "1 h 00 m left of 2 h 00 m"
    )
}

@Test func cardRowsStateTimeSessionsAndWhatIsLeft() {
    let record = DetailStats.record(
        from: [
            sitting(start: 100_000, seconds: 1_800),
            sitting(start: 200_000, seconds: 1_800),
        ],
        now: Date(timeIntervalSince1970: 300_000)
    )
    let rows = DetailStats.rows(
        record: try! #require(record), percent: 50, status: .reading,
        now: Date(timeIntervalSince1970: 300_000)
    )
    #expect(rows.map(\.key) == ["Time read", "Pace", "Last read", "Longest sitting", "Time left"])
    #expect(rows[0].value == "1 h 00 m · 2 sessions")
    #expect(rows[1].value == "About 50% an hour")
    #expect(rows[4].value == "About 1 h 00 m")
}

@Test func aFinishedBookHasNoTimeLeftToState() {
    let record = DetailStats.record(
        from: [sitting(start: 100_000, seconds: 1_800)], now: Date(timeIntervalSince1970: 300_000)
    )
    let rows = DetailStats.rows(
        record: try! #require(record), percent: 50, status: .finished,
        now: Date(timeIntervalSince1970: 300_000)
    )
    #expect(!rows.map(\.key).contains("Time left"))
}

@Test func anAudioOnlyLogSaysListened() {
    let record = DetailStats.record(
        from: [sitting(start: 100_000, seconds: 1_800, format: .listening)],
        now: Date(timeIntervalSince1970: 300_000)
    )
    let rows = DetailStats.rows(
        record: try! #require(record), percent: nil, status: .reading,
        now: Date(timeIntervalSince1970: 300_000)
    )
    #expect(rows.first?.key == "Time listened")
    #expect(!rows.map(\.key).contains("Pace"))
}

@Test func activityStatesTimeAndNeverHowFarAlong() {
    let reader = BookHouseholdReader(
        id: 2, name: "Maren", hasAvatar: false, seconds: 22_320, sessions: 9,
        lastSessionAt: 1_000_000
    )
    let line = DetailStats.activityLine(reader, now: Date(timeIntervalSince1970: 1_000_000))
    #expect(line.hasPrefix("Last read "))
    #expect(line.hasSuffix(" · 6 h 12 m · 9 sessions"))
}

// MARK: - Durations and dates

@Test func durationsReadTheWayThePageStatesThem() {
    #expect(DetailFormat.duration(17_340) == "4 h 49 m")
    #expect(DetailFormat.duration(3_660) == "1 h 01 m")
    #expect(DetailFormat.duration(2_880) == "48 m")
    #expect(DetailFormat.duration(20) == "under a minute")
}

@Test func datesGiveTheYearOnlyWhenItIsNotThisOne() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let locale = Locale(identifier: "en_US")
    // 2026-10-12 12:00 UTC, asked on the 31st.
    let unix: Int64 = 1_791_806_400
    let now = Date(timeIntervalSince1970: 1_793_448_000)
    #expect(DetailFormat.day(unix: unix, now: now, calendar: calendar, locale: locale) == "October 12")
    #expect(DetailFormat.shortDay(unix: unix, now: now, calendar: calendar, locale: locale) == "Oct 12")
    let later = Date(timeIntervalSince1970: 1_825_000_000)
    #expect(
        DetailFormat.day(unix: unix, now: later, calendar: calendar, locale: locale)
            == "October 12, 2026"
    )
}

@Test func lastReadSaysTodayAndYesterdayByCalendarDay() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let locale = Locale(identifier: "en_GB")
    let now = Date(timeIntervalSince1970: 1_793_448_000)  // 2026-10-31 12:00 UTC
    #expect(
        DetailFormat.lastRead(unix: 1_793_444_400, now: now, calendar: calendar, locale: locale)
            == "Today, 11:00"
    )
    // Under 24 hours ago, but the day before.
    #expect(
        DetailFormat.lastRead(unix: 1_793_404_799, now: now, calendar: calendar, locale: locale)
            == "Yesterday, 23:59"
    )
}

// MARK: - The progress bar

@Test func barDivisionsFollowWhereChaptersStart() {
    #expect(StageProgress.weights(starts: [0, 25, 75]) == [25, 50, 25])
    // A chapter that starts past the first percent leaves the front matter
    // its own division.
    #expect(StageProgress.weights(starts: [10, 60]) == [10, 50, 40])
}

@Test func aSliverOfFrontMatterFoldsIntoTheChapterAfterIt() {
    #expect(StageProgress.weights(starts: [0.5, 50]) == [50, 50])
    // At the far end there is nothing after it to fold into.
    #expect(StageProgress.weights(starts: [50, 99.5]) == [50, 50])
}

@Test func aBookWithNoChaptersIsOneDivision() {
    #expect(StageProgress.weights(starts: []) == [100])
    #expect(StageProgress.weights(durations: []) == [1])
}

@Test func aLongBookFoldsItsDivisionsRatherThanDottingTheBar() {
    let starts = stride(from: 0.0, to: 100, by: 2).map { $0 }
    let weights = StageProgress.weights(starts: starts)
    #expect(weights.count <= StageProgress.maxSegments)
    #expect(abs(weights.reduce(0, +) - 100) < 0.001)
}

@Test func barFillsWholeDivisionsThenPartOfOne() {
    let segments = StageProgress.segments(weights: [25, 25, 50], fraction: 0.375)
    #expect(segments.map(\.fill) == [1, 0.5, 0])
}

@Test func barClampsAPositionOffEitherEnd() {
    #expect(StageProgress.segments(weights: [1, 1], fraction: 1.4).map(\.fill) == [1, 1])
    #expect(StageProgress.segments(weights: [1, 1], fraction: -1).map(\.fill) == [0, 0])
}

@Test func flagNamesTheChapterThenTheTimeThenThePercent() {
    #expect(DetailRead.flagLabel(chapter: 6, audioSeconds: 900, percent: 40) == "Ch. 6")
    #expect(DetailRead.flagLabel(chapter: nil, audioSeconds: 9_060, percent: 40) == "2 h 31 m")
    #expect(DetailRead.flagLabel(chapter: nil, audioSeconds: nil, percent: 40) == "40%")
}

@Test func runtimeLineLeavesOutWhatTheRecordDoesNotKnow() {
    #expect(
        DetailRead.runtimeLine(
            hasEbook: true, printPages: 180, hasAudiobook: true, audioDuration: 17_340
        ) == "Ebook · 180 pages · Audiobook · 4 h 49 m"
    )
    #expect(
        DetailRead.runtimeLine(hasEbook: true, printPages: nil, hasAudiobook: false, audioDuration: nil)
            == "Ebook"
    )
}

// MARK: - The series fan

@Test func fanMetaNamesThePlaceInTheSeries() {
    #expect(SeriesFanLayout.meta(index: "2", isThis: true, isNext: false) == "Book 2 · This book")
    #expect(SeriesFanLayout.meta(index: "3", isThis: false, isNext: true) == "Book 3 · Up next")
    #expect(SeriesFanLayout.meta(index: nil, isThis: false, isNext: false) == "")
}

@Test func gatheredFanSpansTheWidthWithThisBookRaised() {
    let last = SeriesFanLayout.pose(index: 4, count: 5, current: 1, width: 358, spread: false)
    #expect(last.x + SeriesFanLayout.cardWidth == 358)
    #expect(last.y == 0)
    let this = SeriesFanLayout.pose(index: 1, count: 5, current: 1, width: 358, spread: false)
    #expect(this.y == -10)
    #expect(this.z > last.z)
}

@Test func spreadFanLiesFlatInARow() {
    let pose = SeriesFanLayout.pose(index: 3, count: 5, current: 1, width: 358, spread: true)
    #expect(pose == SeriesFanLayout.Pose(x: 360, y: 0, rotation: 0, z: 3))
    #expect(SeriesFanLayout.spreadWidth(count: 5) == 584)
}

@Test func aLongSeriesKeepsTheSameOverallTurn() {
    let outer = SeriesFanLayout.pose(index: 0, count: 21, current: 10, width: 358, spread: false)
    #expect(abs(outer.rotation) <= 10)
}

// MARK: - Kept lines

@Test func keptLineQuotesOnlyRowsThatCarryAPassage() {
    func row(text: String?) -> Highlight {
        Highlight(
            id: 1, bookUUID: "b", epubCFIRange: nil, color: .amber,
            note: "a note", text: text, clientID: nil, createdAt: 5
        )
    }

    #expect(KeptLineRow.quotable(row(text: "A kept line")) == "A kept line")
    // A Kobo-origin row can list with no passage; a note alone is no card.
    #expect(KeptLineRow.quotable(row(text: nil)) == nil)
    #expect(KeptLineRow.quotable(row(text: "  \n ")) == nil)
}

@Test func keptLineFooterLeadsWithTheChapterWhenKnown() {
    let now = Date(timeIntervalSince1970: 100_000)
    #expect(KeptLineRow.footer(chapter: "Chapter 5", createdAt: 90_000, now: now).hasPrefix("Chapter 5 · "))
    #expect(!KeptLineRow.footer(chapter: nil, createdAt: 90_000, now: now).contains("·"))
}

private let tocChapters = [
    AlignmentEbookChapter(title: "One", percent: 0, spineIndex: 2),
    AlignmentEbookChapter(title: "Two", percent: 30, spineIndex: 3, anchorPath: "/4/2"),
    AlignmentEbookChapter(title: "Three", percent: 45, spineIndex: 3, anchorPath: "/4/20"),
    AlignmentEbookChapter(title: "Four", percent: 70, spineIndex: 6),
]

@Test func spineStepIsHalvedOutOfThePackagePath() {
    #expect(ChapterLocator.spineIndex(cfi: "epubcfi(/6/14[chap3]!/4/2)") == 6)
    // Odd steps address text nodes, so there is no document to name.
    #expect(ChapterLocator.spineIndex(cfi: "epubcfi(/6/13!/4/2)") == nil)
    #expect(ChapterLocator.spineIndex(cfi: "not a cfi") == nil)
}

@Test func keptLineFindsItsChapterByDocumentThenByPlaceInside() {
    #expect(ChapterLocator.label(chapters: tocChapters, cfi: "epubcfi(/6/6!/4/2)") == "Chapter 1")
    // Document 3 holds two chapters; the anchor decides.
    #expect(ChapterLocator.label(chapters: tocChapters, cfi: "epubcfi(/6/8!/4/10,/1:5,/1:9)") == "Chapter 2")
    #expect(ChapterLocator.label(chapters: tocChapters, cfi: "epubcfi(/6/8!/4/30,/1:5,/1:9)") == "Chapter 3")
    // A document with no chapter of its own belongs to the one before it.
    #expect(ChapterLocator.label(chapters: tocChapters, cfi: "epubcfi(/6/12!/4/2)") == "Chapter 3")
}

@Test func keptLineBeforeTheFirstChapterHasNoChapter() {
    #expect(ChapterLocator.label(chapters: tocChapters, cfi: "epubcfi(/6/2!/4/2)") == nil)
    #expect(ChapterLocator.label(chapters: tocChapters, cfi: nil) == nil)
    #expect(ChapterLocator.label(chapters: [], cfi: "epubcfi(/6/8!/4/2)") == nil)
}

// MARK: - Files

@Test func ebookDetailStatesFormatSizeAndWhetherItIsHeld() {
    let detail = BookFilesCopy.ebookDetail(formats: ["epub", "m4b"], sizeBytes: nil, held: true)
    #expect(detail == "EPUB · downloaded")
}

@Test func audioDetailSaysWhetherItStreams() {
    let files = [
        BookFileInfo(id: 1, format: "m4b", filename: "a.m4b", ordinal: 0)
    ]
    #expect(
        BookFilesCopy.audioDetail(files: files, duration: 17_340, held: false)
            == "M4B · 4 h 49 m · streams"
    )
    #expect(BookFilesCopy.audioDetail(files: files + files, duration: nil, held: true) == "M4B · 2 files · downloaded")
}

@Test func detailsLeaveOutWhatTheRecordDoesNotHold() {
    var book = Book(id: 7, filename: "book.epub")
    book.series = "Sherlock Holmes"
    book.seriesIndex = "2"
    book.language = "en"
    #expect(BookFilesCopy.details(book).map(\.key) == ["Series", "Language", "File"])
    #expect(BookFilesCopy.details(book).first?.value == "Sherlock Holmes, book 2")
}

// MARK: - Journal previews

@Test func journalPreviewStripsMarkdownFromTheOpeningLine() {
    let preview = DetailJournal.preview("**Kvothe** is an *unreliable* narrator\n\nSecond para")
    #expect(preview == [.text("Kvothe is an unreliable narrator")])
}

@Test func journalPreviewKeepsProseCharactersThatLookLikeSyntax() {
    let preview = DetailJournal.preview("Wrote a C# parser in snake_case style")
    #expect(preview == [.text("Wrote a C# parser in snake_case style")])
}

@Test func journalPreviewUnwrapsAListMarker() {
    let preview = DetailJournal.preview("- The Cinder scene lands differently in audio")
    #expect(preview == [.text("The Cinder scene lands differently in audio")])
}

@Test func journalPreviewUnwrapsANumberedOrQuotedOpeningLine() {
    #expect(DetailJournal.preview("1. Started it again") == [.text("Started it again")])
    #expect(DetailJournal.preview("> The Beauty of the House") == [.text("The Beauty of the House")])
    // Prose that merely opens with a year keeps its digits — the marker needs
    // its `.` or `)`.
    #expect(DetailJournal.preview("1984 reads differently now") == [.text("1984 reads differently now")])
}

@Test func journalPreviewVeilsASpoilerSoTheRowCannotLeakIt() {
    // The row is always visible, so the span reaches it only as filler.
    let preview = DetailJournal.preview("Cannot believe ||Fitchner was **ARES**|| honestly")
    #expect(preview == [
        .text("Cannot believe "), .veiled("lorem ipsum dolor"), .text(" honestly"),
    ])
}

@Test func journalPreviewVeilsASpoilerThatOpensTheLine() {
    #expect(DetailJournal.preview("- ||Ares|| was right there") == [
        .veiled("lore"), .text(" was right there"),
    ])
}

// MARK: - Journal byline

private func journalEntry(
    author: Int64, status: JournalStatus = .published
) -> JournalEntry {
    JournalEntry(
        id: author, bookUUID: "b", authorId: author, authorName: "r\(author)",
        bodyMd: "body", bodyHtml: "<p>body</p>", progress: nil, status: status,
        clientID: nil, createdAt: 0, updatedAt: 0
    )
}

@Test func journalBylineNamesOthersAndMarksDrafts() {
    let now = Date(timeIntervalSince1970: 100_000)
    #expect(DetailJournal.byline(journalEntry(author: 2), viewerId: 2, now: now).first != "r")
    #expect(DetailJournal.byline(journalEntry(author: 2), viewerId: 3, now: now).hasPrefix("r2 · "))
    #expect(DetailJournal.byline(journalEntry(author: 2, status: .draft), viewerId: 2, now: now).hasSuffix(" · Draft"))
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


// MARK: - Files link row

@Test func linkRowInvitesALinkWhileFormatsAreNotLinked() {
    let copy = DetailRead.syncRow(state: .notLinked)
    #expect(copy.title == "Link book and audiobook")
    #expect(!copy.linked)
    // No answer yet (offline, or the fetch hasn't landed) reads the same —
    // the sheet it opens states the truth either way.
    #expect(DetailRead.syncRow(state: nil) == copy)
}

@Test func linkRowAsksForACheckWhenTheLinkWentStale() {
    let copy = DetailRead.syncRow(state: .linkStale)
    #expect(copy.title == "Check the book and audiobook link")
    #expect(!copy.linked)
}

@Test func linkRowStatesLinkedForEveryLinkedState() {
    let linked = DetailRead.syncRow(state: .aligned)
    #expect(linked.title == "Book and audiobook linked")
    #expect(linked.linked)
    #expect(DetailRead.syncRow(state: .candidate) == linked)
    #expect(DetailRead.syncRow(state: .nothingNewer) == linked)
}

// MARK: - Tabs

@Test func tabsRunOverviewToFiles() {
    #expect(BookTab.allCases.map(\.label) == ["Overview", "Reviews", "Highlights", "Files"])
}

// MARK: - Suggestions

@Test func suggestionsDecodeEachStatus() throws {
    func decode(_ json: String) throws -> BookSuggestions {
        try JSONDecoder().decode(BookSuggestions.self, from: Data(json.utf8))
    }
    #expect(try decode(#"{"status":"pending"}"#) == .pending)
    #expect(try decode(#"{"status":"not_configured"}"#) == .notConfigured)
    #expect(try decode(#"{"status":"unavailable"}"#) == .unavailable)
    // A status from a newer server is nothing to show, not a failed read.
    #expect(try decode(#"{"status":"reticulating"}"#) == .unavailable)
    let ready = try decode(
        #"{"status":"ready","items":[{"hardcover_id":9,"title":"Dracula","author":"Bram Stoker","#
            + #""hardcover_url":"https://hardcover.app/books/dracula","list_count":3,"#
            + #""cover_url":"/api/suggestions/u/0/cover"}]}"#
    )
    guard case .ready(let items) = ready else {
        Issue.record("expected ready")
        return
    }
    #expect(items.map(\.title) == ["Dracula"])
    #expect(items.first?.coverURL == "/api/suggestions/u/0/cover")
}

@Test func suggestionsSurviveTheReplica() throws {
    let answer = BookSuggestions.ready([
        BookSuggestion(
            hardcoverId: 9, title: "Dracula", author: "Bram Stoker", coverURL: nil,
            hardcoverURL: "https://hardcover.app/books/dracula"
        )
    ])
    let data = try JSONEncoder().encode(answer)
    #expect(try JSONDecoder().decode(BookSuggestions.self, from: data) == answer)
}

// MARK: - The finish card

private func member(_ id: Int64, _ index: String? = nil) -> Book {
    var book = Book(id: id, filename: "\(id).epub")
    book.uniqueIdentifier = "u\(id)"
    book.seriesIndex = index
    return book
}

private func finishTarget(
    reviewKnown: Bool = true, rated: Bool = true, bookID: Int64 = 2, members: [Book] = [],
    states: [String: SeriesMemberState] = [:], settled: Bool = true
) -> FinishTarget? {
    // A member a test doesn't name has answered, and is unread.
    var answered = states
    for book in members where answered[book.uuid] == nil {
        answered[book.uuid] = SeriesMemberState(status: .unread)
    }
    return FinishCopy.target(
        reviewKnown: reviewKnown, rated: rated, bookID: bookID, members: members,
        states: answered, statesSettled: settled
    )
}

private let finishedState = SeriesMemberState(status: .finished, percent: 100)
private let holmes = [member(1, "1"), member(2, "2"), member(3, "3")]

@Test func cardOffersNothingWhileYourRatingIsUnknown() {
    #expect(finishTarget(reviewKnown: false, rated: false, members: holmes) == nil)
}

@Test func cardAsksForAReviewUntilYouHaveRated() {
    #expect(finishTarget(rated: false) == .review)
    #expect(finishTarget(rated: false, members: holmes) == .review)
}

@Test func aStandaloneBookHasNothingNextOnceRated() {
    #expect(finishTarget() == nil)
    #expect(finishTarget(members: [member(2)]) == nil)
}

@Test func cardWaitsForTheSeriesReadsRatherThanPointAndMove() {
    #expect(finishTarget(members: holmes, settled: false) == nil)
}

@Test func nextIsTheBookAfterThisOne() {
    #expect(
        finishTarget(members: holmes) == .next(holmes[2], started: false, percent: nil)
    )
}

@Test func nextAlreadyBegunIsKeepGoing() {
    let states = ["u3": SeriesMemberState(status: .reading, percent: 34)]
    #expect(finishTarget(members: holmes, states: states) == .next(holmes[2], started: true, percent: 34))
}

@Test func aFinishedNextIsSkippedForTheOneAfter() {
    let series = holmes + [member(4, "4")]
    #expect(
        finishTarget(members: series, states: ["u3": finishedState])
            == .next(series[3], started: false, percent: nil)
    )
}

@Test func theLastBookPointsBackAtOneSkipped() {
    #expect(
        finishTarget(bookID: 3, members: holmes, states: ["u2": finishedState])
            == .next(holmes[0], started: false, percent: nil)
    )
}

@Test func aSeriesReadToTheEndSaysSo() {
    #expect(
        finishTarget(members: holmes, states: ["u1": finishedState, "u3": finishedState])
            == .seriesDone
    )
}

@Test func totalsCountDaysSessionsAndHighlights() {
    let record = DetailStats.record(
        from: [
            sitting(start: 100_000, seconds: 600), sitting(start: 200_000, seconds: 600),
        ],
        now: Date(timeIntervalSince1970: 300_000)
    )
    #expect(
        FinishCopy.totals(record: record, finishedAt: 100_000 + 17 * 86_400, highlights: 4)
            == "17 days · 2 sessions · 4 highlights"
    )
    #expect(
        FinishCopy.totals(record: record, finishedAt: 100_000, highlights: 0) == "1 day · 2 sessions"
    )
}

@Test func totalsAreLeftOutWithNoFinishDateOrNothingToCount() {
    #expect(FinishCopy.totals(record: nil, finishedAt: nil, highlights: 4) == nil)
    #expect(FinishCopy.totals(record: nil, finishedAt: 100, highlights: 0) == nil)
    #expect(FinishCopy.totals(record: nil, finishedAt: 100, highlights: 1) == "1 highlight")
}

@Test func nextLinesNameTheBookAndItsPlace() {
    #expect(FinishCopy.nextTitle("The Hound", started: false) == "Up next: The Hound")
    #expect(FinishCopy.nextTitle("The Hound", started: true) == "Keep going: The Hound")
    #expect(
        FinishCopy.nextMeta(index: "3", series: "Sherlock Holmes", percent: nil)
            == "Book 3 of Sherlock Holmes"
    )
    #expect(
        FinishCopy.nextMeta(index: "3", series: "Sherlock Holmes", percent: 34)
            == "34% · Book 3 of Sherlock Holmes"
    )
    #expect(FinishCopy.nextMeta(index: nil, series: "Sherlock Holmes", percent: nil) == "In Sherlock Holmes")
}

@Test func aFinishedSeriesCountsInWords() {
    #expect(FinishCopy.readAll(count: 5) == "You\u{2019}ve read all five")
    #expect(FinishCopy.readAll(count: 2) == "You\u{2019}ve read both")

// MARK: - Kept lines and unanswered reads

@Test func onlyAnEpubPositionOpensInTheEpubReader() {
    let cfi = "epubcfi(/6/8!/4/2,/1:0,/1:10)"
    #expect(DetailRead.opensInBook(hasEpub: true, anchor: cfi))
    #expect(!DetailRead.opensInBook(hasEpub: false, anchor: cfi))
    #expect(!DetailRead.opensInBook(hasEpub: true, anchor: nil))
    // A mixed EPUB and PDF book shares one list of kept lines.
    #expect(!DetailRead.opensInBook(hasEpub: true, anchor: "pdf-page:12"))
    #expect(!DetailRead.opensInBook(hasEpub: true, anchor: "comic-page:3"))
}

@Test func anUnansweredSessionReadIsNotAnEmptyHistory() {
    func line(_ history: ReadAnswer) -> String {
        DetailStats.readingLine(
            status: .reading, wishlistOnly: false, hasFile: true, hasPhysical: false,
            hasPosition: false, record: nil, finishedAt: nil, history: history
        )
    }
    #expect(line(.waiting).isEmpty)
    #expect(line(.failed).contains("couldn\u{2019}t be loaded"))
    #expect(line(.known).contains("No reading recorded yet"))
}

// MARK: - Finish card: what isn't known

@Test func cardPointsNowhereWhileAMembersStatusHasNotAnswered() {
    let states = [
        holmes[0].uuid: SeriesMemberState(status: .finished),
        // Its place answered and its status didn't, so it could be a finished book.
        holmes[2].uuid: SeriesMemberState(status: nil, percent: 40),
    ]
    let target = FinishCopy.target(
        reviewKnown: true, rated: true, bookID: 2, members: holmes,
        states: states, statesSettled: true
    )
    #expect(target == nil)
}

@Test func onlyAFinishSeenWithThePageSettledCelebrates() {
    #expect(FinishCopy.celebrates(settled: true, was: .reading, now: .finished))
    // Cache said reading, server said finished: done on another device.
    #expect(!FinishCopy.celebrates(settled: false, was: .reading, now: .finished))
    #expect(!FinishCopy.celebrates(settled: true, was: .finished, now: .finished))
    #expect(!FinishCopy.celebrates(settled: true, was: .unread, now: .reading))
}

// MARK: - The More menu

private func rows(
    hasFiles: Bool = true, canDownload: Bool = true, canSendToKindle: Bool = true,
    canEdit: Bool = true, wishlisted: Bool = false, isAdmin: Bool = true
) -> BookMenuRows {
    BookMenuRows.resolve(
        hasFiles: hasFiles, canDownload: canDownload, canSendToKindle: canSendToKindle,
        canEdit: canEdit, wishlisted: wishlisted, isAdmin: isAdmin
    )
}

@Test func anAdminSeesEveryRowForABookWithFiles() {
    #expect(
        rows() == BookMenuRows(
            bookmarks: true, export: true, editMetadata: true, removeFromWishlist: false,
            merge: true, delete: true
        )
    )
}

@Test func aReaderSeesNothingThatWritesToTheLibrary() {
    let reader = rows(canEdit: false, isAdmin: false)
    #expect(!reader.editMetadata)
    #expect(!reader.merge)
    #expect(!reader.delete)
    #expect(reader.bookmarks)
    #expect(reader.export)
}

@Test func aRecordWithNoFilesOffersNothingThatNeedsOne() {
    let record = rows(hasFiles: false, wishlisted: true)
    #expect(!record.bookmarks)
    #expect(!record.export)
    #expect(!record.merge)
    #expect(record.removeFromWishlist)
    // Still deletable: that is how a stray record goes.
    #expect(record.delete)
}

@Test func exportNeedsSomewhereForTheBookToGo() {
    #expect(!rows(canDownload: false, canSendToKindle: false).export)
    #expect(rows(canDownload: false, canSendToKindle: true).export)
    #expect(rows(canDownload: true, canSendToKindle: false).export)
}

// MARK: - Bookmarks

private func bookmark(position: String, title: String? = nil) -> Bookmark {
    Bookmark(id: 1, bookUUID: "b", position: position, title: title, clientID: nil, createdAt: 100_000)
}

@Test func aBookmarkIsCalledWhatItWasNamed() {
    #expect(BookmarkCopy.name(bookmark(position: "epubcfi(/6/8!/4)", title: "The Barrel")) == "The Barrel")
    #expect(BookmarkCopy.name(bookmark(position: "epubcfi(/6/8!/4)")) == "Saved position")
    #expect(BookmarkCopy.name(bookmark(position: "4320")) == "Listening, 1 h 12 m in")
}

@Test func aBookmarkPlacesItsChapterWhenItCan() {
    let now = Date(timeIntervalSince1970: 200_000)
    let reading = BookmarkCopy.meta(
        bookmark(position: "epubcfi(/6/6!/4/2)"), chapters: tocChapters, now: now
    )
    #expect(reading.hasPrefix("Chapter 1 · "))
    let listening = BookmarkCopy.meta(bookmark(position: "4320"), chapters: tocChapters, now: now)
    #expect(!listening.contains("Chapter"))
}

// MARK: - Export

@Test func kindleRowFollowsTheSend() {
    func copy(_ state: KindleSendState, hasEpub: Bool = true) -> KindleRowCopy {
        BookExportCopy.kindleRow(gate: .ready, state: state, hasEpub: hasEpub)
    }
    #expect(copy(.idle) == KindleRowCopy(meta: "Emails the EPUB to your Kindle", end: "Send", enabled: true))
    #expect(copy(.idle, hasEpub: false).meta == "Emails the book to your Kindle")
    #expect(copy(.sending).end == "Sending\u{2026}")
    #expect(!copy(.sending).enabled)
    #expect(copy(.sent) == KindleRowCopy(meta: "Sent to your Kindle.", end: "Sent", enabled: false))
    #expect(copy(.failed("No relay")) == KindleRowCopy(meta: "No relay", end: "Retry", enabled: true))
}

@Test func kindleRowSaysWhatIsInTheWay() {
    let noAddress = BookExportCopy.kindleRow(gate: .noAddress, state: .idle, hasEpub: true)
    #expect(noAddress.end == "Settings")
    #expect(noAddress.enabled)
    let oversize = BookExportCopy.kindleRow(gate: .oversize, state: .idle, hasEpub: true)
    #expect(oversize.end == "Open")
    #expect(oversize.enabled)
    let offline = BookExportCopy.kindleRow(gate: .offline, state: .idle, hasEpub: true)
    #expect(offline.meta == "Needs a connection")
    #expect(!offline.enabled)
}

@Test func savedFilesTakeTheTitleAndTheExtensionTheServerSent() {
    #expect(
        BookExportCopy.fileName(title: "Dracula", suggested: "abc.kepub.epub", fallbackExtension: "epub")
            == "Dracula.kepub.epub"
    )
    // A conversion that failed answers with the plain EPUB, and must say so.
    #expect(
        BookExportCopy.fileName(title: "Dracula", suggested: "abc.epub", fallbackExtension: "epub")
            == "Dracula.epub"
    )
    #expect(
        BookExportCopy.fileName(title: "Dracula", suggested: nil, fallbackExtension: "m4b")
            == "Dracula.m4b"
    )
    // A title can't be allowed to name a folder.
    #expect(
        BookExportCopy.fileName(title: "AC/DC: Live", suggested: nil, fallbackExtension: "epub")
            == "AC DC  Live.epub"
    )
}

@Test func exportMetaLeavesOutASizeItDoesNotKnow() {
    #expect(BookExportCopy.ebookMeta(sizeBytes: nil) == "opens the share sheet")
    let files = [BookFileInfo(id: 1, format: "m4b", filename: "a.m4b", ordinal: 0)]
    #expect(BookExportCopy.audioMeta(files: files) == "M4B · opens the share sheet")
}

// MARK: - Bookmarks and the audiobook export

@Test func aBookmarkPositionThatCantBeSecondsIsNeverTreatedAsThem() {
    func bookmark(_ position: String) -> Bookmark {
        Bookmark(id: 1, bookUUID: "b", position: position, title: title, clientID: nil, createdAt: 100_000)
    }
    #expect(BookmarkCopy.listeningSeconds(bookmark("4320")) == 4320)
    // Each of these parses as a Double, and three of them trap in `Int64()`.
    for position in ["nan", "inf", "-inf", "1e30", "-5"] {
        #expect(BookmarkCopy.listeningSeconds(bookmark(position)) == nil)
        #expect(BookmarkCopy.name(bookmark(position)) == "Saved position")
    }
    #expect(BookmarkCopy.listeningSeconds(bookmark("epubcfi(/6/8!/4/2)")) == nil)
    #expect(BookmarkCopy.name(bookmark("4320")).hasPrefix("Listening"))
}

@Test func aMultiPartAudiobookExportsEveryPart() throws {
    func manifest(_ json: String) throws -> AudiobookManifest {
        try JSONDecoder().decode(AudiobookManifest.self, from: Data(json.utf8))
    }
    let part = { (ordinal: Int) in
        #"{"ordinal":\#(ordinal),"url":"/p\#(ordinal)","duration_seconds":60,"mime":"audio/mpeg"}"#
    }
    let two = try manifest(
        #"{"mode":"direct","total_duration_seconds":120,"parts":[\#(part(0)),\#(part(1))]}"#
    )
    #expect(
        BookExportCopy.audioPaths(uuid: "u", manifest: two)
            == ["/api/audiobooks/u/download?part=0", "/api/audiobooks/u/download?part=1"]
    )
    let one = try manifest(#"{"mode":"direct","total_duration_seconds":60,"parts":[\#(part(0))]}"#)
    #expect(BookExportCopy.audioPaths(uuid: "u", manifest: one) == ["/api/audiobooks/u/download"])
    let streamed = try manifest(#"{"mode":"hls","playlist_url":"/m.m3u8"}"#)
    #expect(BookExportCopy.audioPaths(uuid: "u", manifest: streamed) == ["/api/audiobooks/u/download"])
    #expect(
        BookExportCopy.fileName(title: "Dracula", suggested: "a.mp3", fallbackExtension: "m4b", part: 2)
            == "Dracula - part 02.mp3"
    )
}
