//  SiriAnswersTests.swift
//  What Siri says for each reading question, and the review text it hands on.

import Foundation
import Testing

@testable import omnibus

private func book(
    uuid: String = "book-1", title: String = "The Hobbit", author: String = "J. R. R. Tolkien",
    series: String? = nil, formats: [String] = ["epub"]
) -> Book {
    var book = Book(id: 1, filename: "\(uuid).epub", title: title, uniqueIdentifier: uuid, formats: formats)
    book.creators = [Contributor(name: author)]
    book.series = series
    return book
}

private func point(
    _ book: Book = book(), format: ProgressFormat = .epub, percent: Int64? = nil,
    seconds: Double? = nil, duration: Double? = nil
) -> ResumePoint {
    var record = ProgressRecord(
        bookUUID: book.uuid, format: format, audioPositionSeconds: seconds,
        updatedAt: 1_700_000_000, clientUpdatedAt: 1_700_000_000
    )
    record.progressPercent = percent
    record.totalDurationSeconds = duration
    return ResumePoint(record: record, book: book)
}

private func review(
    uuid: String = "book-1", stars: Double? = nil, body: String? = nil,
    notes: String? = nil, spoiler: Bool = false, updatedAt: Int64 = 100
) -> Review {
    Review(
        bookUUID: uuid, stars: stars, bodyMd: body, notesMd: notes, spoiler: spoiler,
        createdAt: updatedAt, updatedAt: updatedAt
    )
}

// MARK: - Currently reading

@Test func currentlyReadingSaysSoWhenNothingIsInProgress() {
    #expect(SiriAnswers.currentlyReading([]) == "You don't have anything in progress.")
}

@Test func currentlyReadingNamesOneBookWithHowFarThrough() {
    let answer = SiriAnswers.currentlyReading([point(percent: 42)])
    #expect(answer == "You're reading The Hobbit, 42% through.")
}

@Test func currentlyReadingSaysListeningForAnAudiobookAndRoundsDown() {
    let audio = point(book(formats: ["m4b"]), format: .audio, seconds: 599, duration: 1000)
    #expect(SiriAnswers.currentlyReading([audio]) == "You're listening to The Hobbit, 59% through.")
}

@Test func currentlyReadingLeavesOutAPercentItCannotKnow() {
    #expect(SiriAnswers.currentlyReading([point()]) == "You're reading The Hobbit.")
}

@Test func currentlyReadingListsEveryTitleWhenSeveralAreInProgress() {
    let answer = SiriAnswers.currentlyReading([
        point(book(uuid: "a", title: "Dune")), point(book(uuid: "b", title: "Emma")),
    ])
    #expect(answer.hasPrefix("You're in the middle of 2 books: "))
    #expect(answer.contains("Dune") && answer.contains("Emma"))
}

// MARK: - Progress

@Test func progressSaysFinishedWhateverThePosition() {
    let answer = SiriAnswers.progress(title: "Dune", point: point(percent: 40), finished: true)
    #expect(answer == "You've finished Dune.")
}

@Test func progressSaysNotStartedWithNoPosition() {
    #expect(SiriAnswers.progress(title: "Dune", point: nil, finished: false) == "You haven't started Dune.")
}

@Test func progressGivesThePercentReadOrListened() {
    #expect(SiriAnswers.progress(title: "Dune", point: point(percent: 75), finished: false)
        == "You've read 75% of Dune.")
    let audio = point(format: .audio, seconds: 30, duration: 120)
    #expect(SiriAnswers.progress(title: "Dune", point: audio, finished: false)
        == "You've listened to 25% of Dune.")
}

@Test func progressAdmitsAPositionWithNoPercent() {
    let answer = SiriAnswers.progress(title: "Dune", point: point(), finished: false)
    #expect(answer.hasPrefix("You've started Dune, but"))
}

// MARK: - Reviews

@Test func reviewTextLeadsWithBookAndStarsAndNeverCarriesNotes() {
    let text = SiriAnswers.reviewText(
        review(stars: 4.5, body: "A *quiet* triumph.", notes: "private", spoiler: true),
        book: book()
    )
    #expect(text == "The Hobbit by J. R. R. Tolkien — 4.5 out of 5 stars\n\nContains spoilers.\n\nA *quiet* triumph.")
    #expect(!text.contains("private"))
}

@Test func reviewTextForABareRatingIsTheHeadingAlone() {
    let text = SiriAnswers.reviewText(review(stars: 4), book: book())
    #expect(text == "The Hobbit by J. R. R. Tolkien — 4 out of 5 stars")
}

@Test func reviewTextFallsBackToAPlainHeadingWithoutTheBook() {
    #expect(SiriAnswers.reviewText(review(body: "Good."), book: nil) == "My review\n\nGood.")
}

@Test func latestPrefersTheNewestWrittenReviewOverANewerRating() {
    let written = review(uuid: "a", body: "Words", updatedAt: 100)
    let rated = review(uuid: "b", stars: 3, updatedAt: 200)
    #expect(SiriAnswers.latest(of: [rated, written])?.bookUUID == "a")
}

@Test func latestFallsBackToTheNewestRatingWhenNothingIsWritten() {
    let older = review(uuid: "a", stars: 2, updatedAt: 100)
    let newer = review(uuid: "b", stars: 5, body: "  ", updatedAt: 200)
    #expect(SiriAnswers.latest(of: [older, newer])?.bookUUID == "b")
    #expect(SiriAnswers.latest(of: []) == nil)
}

// MARK: - Spoken titles

@Test func searchCandidatesLoosenASpokenRequestStrictestFirst() {
    #expect(SiriAnswers.searchCandidates(for: "The Hobbit by Tolkien audiobook")
        == ["The Hobbit by Tolkien audiobook", "The Hobbit by Tolkien", "The Hobbit"])
    #expect(SiriAnswers.searchCandidates(for: " Dune ") == ["Dune"])
}

// MARK: - Entity and cache scope

@Test func bookEntityCarriesTheDisplayNamesAndDropsABlankSeries() {
    let entity = BookEntity(book(series: " ", formats: ["epub", "m4b"]))
    #expect(entity.id == "book-1")
    #expect(entity.title == "The Hobbit")
    #expect(entity.author == "J. R. R. Tolkien")
    #expect(entity.series == nil)
    #expect(entity.hasAudiobook)
}

@Test func aQueuedReviewHoldsTheLatestReviewsListOnTheReplica() {
    #expect(OutboxScope.isBlocked(CacheKey.myReviews, by: [OpKind.review("book-1")]))
    #expect(!OutboxScope.isBlocked(CacheKey.myReviews, by: [OpKind.progress("book-1", .epub)]))
}
