//  CarPlayContentTests.swift
//  What the CarPlay screens show and offer.
//
//  CarPlay's templates can't be read back from a test, so these pin the
//  decisions they are built from: the speed the button steps to, which
//  chapters the list opens on, a Continue row's text, the Library list's
//  paging, Now Playing's buttons, and the copy of the sheets and alerts.

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
