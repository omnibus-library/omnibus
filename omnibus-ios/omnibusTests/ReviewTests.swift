//  ReviewTests.swift
//  Reviews on the book detail: the wire shapes, the merge-patch body the card
//  and composer send, the optimistic replica patch a queued write shows, and
//  the block's own decisions — the spoiler rule, the grouping of other
//  readers, and the household summary's bars.

import Foundation
import Testing

@testable import omnibus

// MARK: - Fixtures

private let uuid = "11111111-2222-3333-4444-555555555555"

private func review(
    stars: Double? = nil, body: String? = nil, notes: String? = nil, spoiler: Bool = false,
    at clock: Int64 = 100
) -> Review {
    Review(
        bookUUID: uuid, stars: stars, bodyMd: body, bodyHtml: body.map { "<p>\($0)</p>" },
        notesMd: notes, notesHtml: notes.map { "<p>\($0)</p>" }, spoiler: spoiler,
        ratedAt: stars == nil ? nil : clock, createdAt: clock, updatedAt: clock
    )
}

private func other(
    _ id: Int64, stars: Double? = nil, body: String? = nil, spoiler: Bool = false
) -> AttributedReview {
    AttributedReview(
        userId: id, username: "reader \(id)", stars: stars, bodyMd: body,
        bodyHtml: body.map { "<p>\($0)</p>" }, spoiler: spoiler, ratedAt: nil,
        createdAt: 100, updatedAt: 100
    )
}

/// The patch as the server will read it: a JSON object, key order aside.
private func wire(_ patch: ReviewPatch) throws -> [String: Any] {
    let data = try JSONEncoder().encode(patch)
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

// MARK: - Wire shapes

@Suite("Review wire shapes")
struct ReviewCodecTests {
    @Test("a book's reviews decode, notes on yours and the summary's ten buckets")
    func bookReviewsDecode() throws {
        let buckets = (1...10).map { #"{"half_stars":\#($0),"readers":\#($0 == 9 ? 2 : 0)}"# }
            .joined(separator: ",")
        let json = """
            {"mine":{"book_uuid":"\(uuid)","stars":4.5,"body_md":"Loved it","body_html":"<p>Loved it</p>",
              "notes_md":"reread ch 3","notes_html":"<p>reread ch 3</p>","spoiler":true,
              "rated_at":1700000000,"created_at":1700000000,"updated_at":1700000001,
              "rated_at_iso":"2023-11-14T22:13:20Z"},
             "others":[{"user_id":2,"username":"Bea","has_avatar":true,"stars":4.5,
              "body_md":null,"body_html":null,"spoiler":false,"rated_at":1700000000,
              "created_at":1700000000,"updated_at":1700000000}],
             "summary":{"average_stars":4.5,"ratings":2,"buckets":[\(buckets)]}}
            """
        let decoded = try JSONDecoder().decode(BookReviews.self, from: Data(json.utf8))
        #expect(decoded.mine?.stars == 4.5)
        #expect(decoded.mine?.notesMd == "reread ch 3")
        #expect(decoded.mine?.spoiler == true)
        #expect(decoded.others.first?.hasAvatar == true)
        #expect(decoded.others.first?.hasText == false)
        #expect(decoded.summary?.buckets.count == 10)
        #expect(decoded.summary?.buckets[8].readers == 2)
    }

    @Test("a book nobody has reviewed decodes with no review and no summary")
    func emptyBookReviewsDecode() throws {
        let json = #"{"mine":null,"others":[],"summary":null}"#
        let decoded = try JSONDecoder().decode(BookReviews.self, from: Data(json.utf8))
        #expect(decoded == .empty)
    }

    @Test("the replica's own encoding reads back unchanged")
    func replicaRoundTrip() throws {
        let reviews = BookReviews(
            mine: review(stars: 3, body: "ok", notes: "private"),
            others: [other(2, stars: 5, body: "great", spoiler: true)],
            summary: ReviewSummary(averageStars: 4, ratings: 2, buckets: [])
        )
        let data = try JSONEncoder().encode(reviews)
        #expect(try JSONDecoder().decode(BookReviews.self, from: data) == reviews)
    }

    @Test("a bucket labels its value in stars, as the stats histogram does")
    func bucketLabels() {
        #expect(ReviewBucket(halfStars: 1, readers: 0).starLabel == "0.5")
        #expect(ReviewBucket(halfStars: 8, readers: 0).starLabel == "4")
    }
}

// MARK: - The patch body

@Suite("Review patch encoding")
struct ReviewPatchEncodingTests {
    @Test("an untouched field is left out of the body entirely")
    func unchangedFieldsAreOmitted() throws {
        let body = try wire(ReviewPatch(stars: .set(4)))
        #expect(Set(body.keys) == ["stars"])
        #expect((body["stars"] as? NSNumber)?.doubleValue == 4)
    }

    @Test("a cleared field is sent as an explicit null")
    func clearedFieldsAreNull() throws {
        let body = try wire(ReviewPatch(stars: .cleared, notesMd: .cleared))
        #expect(Set(body.keys) == ["stars", "notes_md"])
        #expect(body["stars"] is NSNull)
        #expect(body["notes_md"] is NSNull)
    }

    @Test("text and the spoiler flag go under the server's names")
    func textAndSpoilerKeys() throws {
        let body = try wire(ReviewPatch(bodyMd: .set("Loved it"), spoiler: true))
        #expect(body["body_md"] as? String == "Loved it")
        #expect((body["spoiler"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true)
        #expect(body["spoiler"] as? Bool == true)
    }

    @Test("an empty patch is an empty object and says so")
    func emptyPatch() throws {
        #expect(try wire(ReviewPatch()).isEmpty)
        #expect(ReviewPatch().isEmpty)
        #expect(!ReviewPatch(spoiler: false).isEmpty)
    }

    @Test("a star tap sets the value; tapping to zero clears only the stars")
    func starsPatch() {
        #expect(ReviewPatch.stars(3.5) == ReviewPatch(stars: .set(3.5)))
        #expect(ReviewPatch.stars(0) == ReviewPatch(stars: .cleared))
    }
}

@Suite("Composer edits")
struct ReviewComposerEditTests {
    @Test("only the fields the composer changed are sent")
    func onlyChangedFields() {
        let original = review(stars: 4, body: "Good", notes: "mine")
        let patch = ReviewPatch.edits(from: original, body: "Great", notes: "mine", spoiler: false)
        #expect(patch == ReviewPatch(bodyMd: .set("Great")))
    }

    @Test("emptying a field clears it rather than storing blank text")
    func emptiedFieldClears() {
        let original = review(body: "Good", notes: "mine")
        let patch = ReviewPatch.edits(from: original, body: "  \n", notes: "", spoiler: false)
        #expect(patch == ReviewPatch(bodyMd: .cleared, notesMd: .cleared))
    }

    @Test("a field that was never written and stays blank sends nothing")
    func blankAbsentFieldIsUnchanged() {
        let patch = ReviewPatch.edits(from: nil, body: "", notes: "  ", spoiler: false)
        #expect(patch.isEmpty)
    }

    @Test("a first review sends its text, its notes and a raised spoiler flag")
    func firstReview() {
        let patch = ReviewPatch.edits(from: nil, body: "Twist!", notes: "n", spoiler: true)
        #expect(patch == ReviewPatch(bodyMd: .set("Twist!"), notesMd: .set("n"), spoiler: true))
    }

    @Test("the spoiler flag is sent only when it moved, and moving it alone is a change")
    func spoilerOnlyWhenChanged() {
        let original = review(body: "x", spoiler: true)
        #expect(ReviewPatch.edits(from: original, body: "x", notes: "", spoiler: true).isEmpty)
        #expect(
            ReviewPatch.edits(from: original, body: "x", notes: "", spoiler: false)
                == ReviewPatch(spoiler: false)
        )
    }
}

// MARK: - Optimistic replica patch

@Suite("Optimistic review patch")
struct ReviewOptimisticTests {
    @Test("new stars land and move both the rating clock and the public clock")
    func starsMoveTheClocks() throws {
        let next = try #require(review(stars: 3, body: "ok").applying(.stars(4.5), now: 200))
        #expect(next.stars == 4.5)
        #expect(next.ratedAt == 200)
        #expect(next.updatedAt == 200)
        #expect(next.bodyMd == "ok")
    }

    @Test("clearing the stars keeps the text and notes")
    func clearingStarsKeepsText() throws {
        let next = try #require(
            review(stars: 3, body: "ok", notes: "n").applying(.stars(0), now: 200)
        )
        #expect(next.stars == nil)
        #expect(next.ratedAt == nil)
        #expect(next.bodyMd == "ok")
        #expect(next.notesMd == "n")
    }

    @Test("edited text shows its Markdown until the server renders it")
    func editedTextDropsStaleHTML() throws {
        let next = try #require(
            review(body: "old").applying(ReviewPatch(bodyMd: .set("**new**")), now: 200)
        )
        #expect(next.bodyMd == "**new**")
        #expect(next.bodyHtml == nil)
    }

    @Test("an edit to the private notes alone moves no public clock")
    func notesOnlyEditIsPrivate() throws {
        let next = try #require(
            review(stars: 4, notes: "a").applying(ReviewPatch(notesMd: .set("b")), now: 200)
        )
        #expect(next.notesMd == "b")
        #expect(next.notesHtml == nil)
        #expect(next.updatedAt == 100)
    }

    @Test("raising the spoiler flag lands and moves the public clock")
    func spoilerFlagIsPublic() throws {
        let next = try #require(review(body: "x").applying(ReviewPatch(spoiler: true), now: 200))
        #expect(next.spoiler)
        #expect(next.updatedAt == 200)
        #expect(next.bodyMd == "x")
    }

    @Test("a patch that empties the review deletes it, as the server does")
    func emptiedReviewIsGone() {
        let only = review(stars: 4)
        #expect(only.applying(.stars(0), now: 200) == nil)
        let text = review(body: "x")
        #expect(text.applying(ReviewPatch(bodyMd: .set("   ")), now: 200) == nil)
    }

    @Test("the first write creates your review and leaves everyone else alone")
    func firstWriteCreatesTheReview() throws {
        let page = BookReviews(
            mine: nil, others: [other(2, stars: 5)],
            summary: ReviewSummary(averageStars: 4.5, ratings: 2, buckets: [])
        )
        let next = page.applying(.stars(2), uuid: uuid, now: 300)
        let mine = try #require(next.mine)
        #expect(mine.bookUUID == uuid)
        #expect(mine.stars == 2)
        #expect(mine.createdAt == 300)
        #expect(next.others == page.others)
        // The summary is the server's arithmetic, refetched once the write lands.
        #expect(next.summary == page.summary)
    }

    @Test("deleting removes only your review")
    func deleteRemovesMine() {
        let page = BookReviews(mine: review(stars: 4), others: [other(2, stars: 3)], summary: nil)
        let next = page.deletingMine()
        #expect(next.mine == nil)
        #expect(next.others == page.others)
    }
}

// MARK: - The block's decisions

@Suite("Reviews block")
struct DetailReviewsTests {
    @Test("a spoiler review stays collapsed until the viewer has finished the book")
    func spoilerCollapsesUntilFinished() {
        #expect(DetailReviews.hidesText(spoiler: true, viewerStatus: .unread))
        #expect(DetailReviews.hidesText(spoiler: true, viewerStatus: .reading))
        #expect(!DetailReviews.hidesText(spoiler: true, viewerStatus: .finished))
        #expect(!DetailReviews.hidesText(spoiler: false, viewerStatus: .reading))
    }

    @Test("written reviews and bare ratings are split, each in the server's order")
    func groupsOtherReaders() {
        let others = [
            other(1, stars: 4, body: "newest"), other(2, body: "older, no stars"),
            other(3, stars: 5), other(4, stars: 2), other(5, body: "  "),
        ]
        #expect(DetailReviews.written(others).map(\.userId) == [1, 2])
        // Blank text is no text; with no stars either there is nothing to show.
        #expect(DetailReviews.starsOnly(others).map(\.userId) == [3, 4])
    }

    @Test("the title line reads the average to one decimal and counts readers")
    func titleLine() {
        let summary = ReviewSummary(averageStars: 4.333, ratings: 3, buckets: [])
        #expect(DetailReviews.titleLine(summary) == "4.3 · 3 readers")
    }

    @Test("the kicker counts other readers, and is bare with none")
    func kicker() {
        #expect(DetailReviews.kicker(othersCount: 0) == "Reviews")
        #expect(DetailReviews.kicker(othersCount: 1) == "Reviews · 1 other reader")
        #expect(DetailReviews.kicker(othersCount: 4) == "Reviews · 4 other readers")
    }

    @Test("the summary draws all ten buckets, empty ones as slots")
    func summaryBars() {
        let buckets = (1...10).map { ReviewBucket(halfStars: Int64($0), readers: $0 == 8 ? 3 : 0) }
        let bars = DetailReviews.summaryBars(buckets)
        #expect(bars.count == 10)
        #expect(bars[7].fraction == 1)
        #expect(bars[7].value == "3")
        #expect(bars[7].title == "4 \u{2605} · 3 readers")
        #expect(bars[0].isEmpty)
        #expect(bars[0].value == nil)
    }

    @Test("an excerpt censors spoilers and resolves Markdown")
    func excerptIsSafe() {
        let md = "# Verdict\n\nThe **ending** — ||she lives|| — got me."
        #expect(DetailReviews.excerpt(md) == "Verdict\nThe ending — \u{2588}\u{2588}\u{2588} — got me.")
    }

    @Test("Read more is offered exactly when the set text runs past the collapsed height")
    func readMoreWhenTruncated() {
        #expect(!DetailReviews.isTruncated(fullHeight: 0))
        #expect(!DetailReviews.isTruncated(fullHeight: DetailReviews.collapsedTextHeight))
        #expect(DetailReviews.isTruncated(fullHeight: DetailReviews.collapsedTextHeight + 20))
    }

    @Test("an image-only review has no text to set, and one with words does")
    func imageOnlyReviewHasNoText() {
        #expect(!DetailReviews.hasVisibleText("![](/api/journals/images/a.png)"))
        #expect(DetailReviews.hasVisibleText("Look: ![](/api/journals/images/a.png) the map"))
        #expect(DetailReviews.excerpt("![](/x.png)\nwords") == "words")
    }

    @Test("the marquee's hand-off names the other readers, or your own review")
    func allLabel() {
        #expect(DetailReviews.allLabel(othersCount: 0) == "Your whole review")
        #expect(DetailReviews.allLabel(othersCount: 1) == "All reviews · 1 other reader")
        #expect(DetailReviews.allLabel(othersCount: 3) == "All reviews · 3 other readers")
        #expect(DetailReviews.hasWriting(review(notes: "n")))
        #expect(!DetailReviews.hasWriting(review(stars: 4, body: " ")))
    }

    @Test("the pencil writes a review until there is text or notes, then edits it")
    func composeLabel() {
        #expect(DetailReviews.composeLabel(nil) == "Write review")
        // Stars alone are not something the editor holds.
        #expect(DetailReviews.composeLabel(review(stars: 4)) == "Write review")
        #expect(DetailReviews.composeLabel(review(body: "ok")) == "Edit review")
        #expect(DetailReviews.composeLabel(review(notes: "n")) == "Edit review")
    }

    @Test("the stars note says why an unknown review can't be written yet")
    func unknownNote() {
        #expect(DetailReviews.unknownNote(.loading) == "loading your review")
        #expect(DetailReviews.unknownNote(.unavailable(.offline)) == "loads when you're back online")
        // A refusal or a fault is not an outage, and waiting won't fix it.
        #expect(DetailReviews.unknownNote(.unavailable(.failed)) == "couldn't load · pull down to retry")
    }

    @Test("the note beside your stars says whether you have rated")
    func starsNote() {
        #expect(DetailReviews.starsNote(nil) == "tap a star to rate")
        #expect(DetailReviews.starsNote(4.5) == "rated 4.5 of 5")
    }
}

// MARK: - An unknown review

@Suite("Unknown review")
struct UnknownReviewTests {
    @Test("no read yet is loading, a settled read with nothing is unavailable, an answer is ready")
    func cardStateResolves() {
        #expect(ReviewCardState.resolve(nil, failure: nil) == .loading)
        #expect(ReviewCardState.resolve(nil, failure: .offline) == .unavailable(.offline))
        #expect(ReviewCardState.resolve(nil, failure: .failed) == .unavailable(.failed))
        // An answer wins over a stale failure flag, and "no review" is known.
        #expect(ReviewCardState.resolve(.empty, failure: .offline) == .ready(nil))
        let mine = review(stars: 4)
        let page = BookReviews(mine: mine, others: [], summary: nil)
        #expect(ReviewCardState.resolve(page, failure: nil) == .ready(mine))
    }

    @Test("only a known review is writable")
    func onlyKnownIsInteractive() {
        #expect(!ReviewCardState.loading.isInteractive)
        #expect(!ReviewCardState.unavailable(.offline).isInteractive)
        #expect(ReviewCardState.ready(nil).isInteractive)
        #expect(ReviewCardState.loading.review == nil)
    }

    @Test("the composer opens only on a known review, seeded from it")
    func composerNeedsAKnownBaseline() throws {
        #expect(ReviewComposerTarget.make(for: .loading) == nil)
        #expect(ReviewComposerTarget.make(for: .unavailable(.failed)) == nil)
        let blank = try #require(ReviewComposerTarget.make(for: .ready(nil)))
        #expect(blank.original == nil)
        let mine = review(body: "kept")
        let seeded = try #require(ReviewComposerTarget.make(for: .ready(mine)))
        #expect(seeded.original == mine)
    }

    @Test("a read that answered, or was only cancelled, leaves no failure behind")
    func classifyLeavesNothingWithoutAFailure() {
        #expect(ReviewsReadFailure.classify(APIError.offline, answered: true, cancelled: false) == nil)
        #expect(ReviewsReadFailure.classify(APIError.offline, answered: false, cancelled: true) == nil)
        #expect(ReviewsReadFailure.classify(CancellationError(), answered: false, cancelled: false) == nil)
        // Finished with no answer and no error: the stream was torn down.
        #expect(ReviewsReadFailure.classify(nil, answered: false, cancelled: false) == nil)
    }

    @Test("no connection reads as offline; anything else the server did reads as failed")
    func classifySeparatesOfflineFromFailed() {
        #expect(ReviewsReadFailure.classify(APIError.offline, answered: false, cancelled: false) == .offline)
        #expect(
            ReviewsReadFailure.classify(APIError.transport("reset"), answered: false, cancelled: false)
                == .offline
        )
        #expect(
            ReviewsReadFailure.classify(
                APIError.http(status: 500, message: ""), answered: false, cancelled: false
            ) == .failed
        )
        #expect(ReviewsReadFailure.classify(APIError.unauthorized, answered: false, cancelled: false) == .failed)
        #expect(
            ReviewsReadFailure.classify(APIError.decoding("x"), answered: false, cancelled: false) == .failed
        )
    }

    @Test("coming back online rereads only a review that is still unknown")
    func rereadOnReconnect() {
        #expect(DetailReviews.rereadsOnReconnect(wasOnline: false, isOnline: true, known: false))
        #expect(!DetailReviews.rereadsOnReconnect(wasOnline: false, isOnline: true, known: true))
        #expect(!DetailReviews.rereadsOnReconnect(wasOnline: true, isOnline: false, known: false))
        #expect(!DetailReviews.rereadsOnReconnect(wasOnline: true, isOnline: true, known: false))
    }

    @MainActor
    @Test("the page writes nothing against an unknown review")
    func modelRefusesWritesWhileUnknown() async {
        let model = BookDetailModel()
        await model.patchReview(ReviewPatch(bodyMd: .set("typed")), uuid: uuid)
        #expect(model.reviews == nil)
        await model.deleteReview(uuid: uuid)
        #expect(model.reviews == nil)
    }
}

// MARK: - The composer's draft

@Suite("Review draft")
struct ReviewDraftTests {
    @Test("a field you haven't touched follows a fresher review, and Save sends nothing for it")
    func untouchedFieldsFollow() {
        var draft = ReviewDraft(review(body: "replica", notes: "n"))
        let conflicts = draft.rebase(onto: review(body: "fresh", notes: "n", spoiler: true))
        #expect(conflicts.isEmpty)
        #expect(draft.body == "fresh")
        #expect(draft.spoiler)
        #expect(draft.patch.isEmpty)
    }

    @Test("a field you typed in is kept, and diffed against the fresher review")
    func typedFieldIsKept() {
        var draft = ReviewDraft(review(body: "old", notes: "n"))
        draft.body = "mine"
        // Only the notes moved underneath: no conflict over the text.
        let conflicts = draft.rebase(onto: review(body: "old", notes: "moved"))
        #expect(conflicts.isEmpty)
        #expect(draft.body == "mine")
        #expect(draft.notes == "moved")
        #expect(draft.patch == ReviewPatch(bodyMd: .set("mine")))
    }

    @Test("a field you typed in that also changed elsewhere is kept and reported")
    func typedFieldThatMovedConflicts() {
        var draft = ReviewDraft(review(body: "old"))
        draft.body = "mine"
        let conflicts = draft.rebase(onto: review(body: "theirs"))
        #expect(conflicts == [.body])
        #expect(draft.body == "mine")
        #expect(draft.patch == ReviewPatch(bodyMd: .set("mine")))
    }

    @Test("opening on no review, then learning there is one, adopts it")
    func unknownToKnownAdopts() {
        var draft = ReviewDraft(nil)
        let conflicts = draft.rebase(onto: review(body: "there all along"))
        #expect(conflicts.isEmpty)
        #expect(draft.body == "there all along")
        #expect(draft.patch.isEmpty)
    }

    @Test("the conflict note names what changed, or is absent")
    func conflictNote() {
        #expect(DetailReviews.conflictNote([]) == nil)
        #expect(
            DetailReviews.conflictNote([.body])
                == "Your review text changed elsewhere while this was open — Save keeps yours."
        )
        #expect(
            DetailReviews.conflictNote([.spoiler, .body, .notes])
                == "Your review text, private notes and spoiler flag changed elsewhere while this was open — Save keeps yours."
        )
    }
}

// MARK: - How review writes queue

@Suite("Review outbox ops")
struct ReviewOutboxOpTests {
    @Test("a review patch absorbs the book's pre-review rating op")
    func patchAbsorbsLegacy() {
        let op = ReviewOutbox.patch(uuid: uuid)
        #expect(op.kind == OpKind.review(uuid))
        #expect(op.path == "/api/reviews/\(uuid)")
        #expect(op.method == "PATCH")
        #expect(op.legacyStars == OpKind.rating(uuid))
    }

    @Test("a review delete supersedes the book's pre-review rating op")
    func deleteSupersedesLegacy() {
        let op = ReviewOutbox.delete(uuid: uuid)
        #expect(op.kind == OpKind.review(uuid))
        #expect(op.method == "DELETE")
        #expect(op.superseding == [OpKind.rating(uuid)])
        #expect(op.legacyStars == nil)
    }
}
