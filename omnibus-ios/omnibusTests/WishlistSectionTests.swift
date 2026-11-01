//  WishlistSectionTests.swift
//  The wishlist's copy on the book page: how an entry describes itself, and
//  what the removal confirmation warns about.
//
//  The source phrases mirror `source_label` on the web page, so the two
//  surfaces can't drift on what "from a scan" means. The confirmation is the
//  part worth pinning: a fileless book is only *visible* because of its
//  wishlist entry — the browse query hides a fileless book with no physical
//  copy — so the warning has to differ from the one a book with files gets.

import Foundation
import Testing

@testable import omnibus

@Suite("Wishlist copy")
struct WishlistSectionTests {
    @Test("names where a scanned entry came from")
    func labelsAScan() {
        #expect(WishlistCopy.sourceLabel(.scan) == "a scan")
    }

    @Test("names the detail page as its own source")
    func labelsTheDetailPage() {
        #expect(WishlistCopy.sourceLabel(.detail) == "this page")
    }

    @Test("names a typed ISBN rather than calling it a scan")
    func labelsManualEntry() {
        #expect(WishlistCopy.sourceLabel(.manual) == "an ISBN you entered")
    }

    @Test("names a title search, where the reader supplied a title and not an ISBN")
    func labelsATitleSearch() {
        #expect(WishlistCopy.sourceLabel(.search) == "a title search")
    }

    @Test("states how long it has been tracked, and what to do about it")
    func trackingLineReadsAsOneSentence() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let line = WishlistCopy.trackingLine(
            since: 1_791_000_000, now: Date(timeIntervalSince1970: 1_791_000_000)
        )
        #expect(line.hasPrefix("Tracking since "))
        #expect(line.hasSuffix(". Check it in when you find a copy."))
    }

    @Test("a book with files is told it keeps them")
    func confirmMessageReassuresWhenFilesRemain() {
        let message = WishlistCopy.confirmMessage(hasFiles: true)
        #expect(message == "This stops tracking a physical copy. The book stays in your library.")
    }

    @Test("a book with no files is warned the wishlist is all there is")
    func confirmMessageWarnsWhenTheEntryIsTheOnlyThingHoldingIt() {
        // Removing the entry takes the last way back to a book the browse
        // query already hides — the reader must be told before, not after.
        let message = WishlistCopy.confirmMessage(hasFiles: false)
        #expect(message != WishlistCopy.confirmMessage(hasFiles: true))
        #expect(message.contains("the only place it shows up"))
    }
}
