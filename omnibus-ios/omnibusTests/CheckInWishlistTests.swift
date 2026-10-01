//  CheckInWishlistTests.swift
//  Scanning a book already on the wishlist says so. A different edition's
//  barcode reaches the wished-for book through the fuzzy rung, which carries no
//  wishlist state — so the flow asks per candidate, names the wishlist on the
//  card, and the success screen says the wish is settled.

import Foundation
import Testing

@testable import omnibus

private func scanBook(uuid: String) -> ScanBook {
    ScanBook(uuid: uuid, title: "Babel", authors: ["R. F. Kuang"], coverURL: nil, hasPhysical: false, isbn: nil)
}

private let scanned = ExternalBookMeta(
    isbn13: "9780063021426", title: "Babel", authors: ["R. F. Kuang"],
    year: "2022", pages: 560, publisher: nil, description: nil,
    coverURL: nil, source: "openlibrary"
)

struct CheckInWishlistTests {
    @Test("a close match asks after every candidate's wishlist state")
    func closeMatchLooksUpEveryCandidate() {
        let stage = CheckInStage.outcome(
            .closeMatch(books: [scanBook(uuid: "a"), scanBook(uuid: "b")], scanned: scanned)
        )
        #expect(CheckInFlow.wishlistLookups(for: stage) == ["a", "b"])
    }

    @Test("outcomes that already know, or have no library book, ask nothing")
    func otherStagesAskNothing() {
        #expect(CheckInFlow.wishlistLookups(for: .scan).isEmpty)
        #expect(CheckInFlow.wishlistLookups(for: .outcome(.onWishlist(book: scanBook(uuid: "a")))).isEmpty)
        #expect(CheckInFlow.wishlistLookups(for: .outcome(.notInLibrary(online: scanned))).isEmpty)
    }

    @Test("a wishlisted candidate names the wishlist and what checking in does to it")
    func wishlistedCandidateSaysSo() {
        let label = CheckInFlow.candidateLabel(isWishlisted: true)
        #expect(label.badge == "On your wishlist")
        #expect(label.note?.contains("clears this book from your wishlist") == true)
    }

    @Test("any other candidate stays a possible match")
    func otherCandidateIsAPossibleMatch() {
        let label = CheckInFlow.candidateLabel(isWishlisted: false)
        #expect(label.badge == "Possible match")
        #expect(label.note == nil)
    }

    @Test("checking in a wishlisted book says the wish is settled, naming the book")
    func wishlistCheckInSuccessSaysSo() {
        let success = CheckInFlow.checkedInSuccess(
            book: scanBook(uuid: "a"), ref: BookRef(bookUUID: "a"), fromWishlist: true
        )
        #expect(success.headline == "Off your wishlist, on your shelf")
        #expect(success.title == "Babel")
        #expect(success.bookUUID == "a")
    }
}
