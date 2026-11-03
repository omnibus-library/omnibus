//  WishlistsFlowTests.swift
//  The Wishlists screen's pure decisions: whose list, how it is titled and
//  described, and what each row says.

import Foundation
import Testing

@testable import omnibus

private func reader(_ id: Int64, _ name: String, isYou: Bool = false, count: Int64 = 0) -> WishlistReader {
    WishlistReader(id: id, name: name, hasAvatar: false, isYou: isYou, count: count)
}

private func readers(_ list: [WishlistReader], everyone: Int64 = 0) -> WishlistReaders {
    WishlistReaders(everyone: everyone, readers: list)
}

private func scanBook(_ uuid: String) -> ScanBook {
    ScanBook(uuid: uuid, title: "Dune", authors: ["Frank Herbert"], coverURL: nil, hasPhysical: false, isbn: nil)
}

private func meta(_ isbn: String = "9780441172719", source: String = "open_library") -> ExternalBookMeta {
    ExternalBookMeta(
        isbn13: isbn, title: "Dune", authors: ["Frank Herbert"], year: nil, pages: nil,
        publisher: nil, description: nil, coverURL: nil, source: source
    )
}

struct WishlistsFlowTests {
    @Test func userParamIsNilForYouAllForEveryoneAndTheIdForAReader() {
        #expect(WishlistScope.you.userParam == nil)
        #expect(WishlistScope.everyone.userParam == "all")
        #expect(WishlistScope.reader(id: 7).userParam == "7")
    }

    @Test func pickerOptionsLeadWithEveryoneThenYouThenTheOtherReaders() {
        let list = readers([reader(1, "Sam", isYou: true), reader(2, "Ada"), reader(3, "Ben")])
        #expect(
            WishlistsFlow.pickerOptions(from: list)
                == [.everyone, .you, .reader(id: 2), .reader(id: 3)]
        )
        #expect(WishlistsFlow.pickerOptions(from: nil) == [.everyone, .you])
    }

    @Test func pickerOptionsNeverListTheIsYouRowTwice() {
        let list = readers([reader(2, "Ada"), reader(1, "Sam", isYou: true)])
        #expect(WishlistsFlow.pickerOptions(from: list) == [.everyone, .you, .reader(id: 2)])
    }

    @Test func titleNamesYourListEveryonesOrTheReaders() {
        let list = readers([reader(1, "Sam", isYou: true), reader(2, "Ada")])
        #expect(WishlistsFlow.title(.you, readers: list) == "Your Wishlist")
        #expect(WishlistsFlow.title(.everyone, readers: list) == "Everyone\u{2019}s Wishlists")
        #expect(WishlistsFlow.title(.reader(id: 2), readers: list) == "Ada\u{2019}s Wishlist")
        #expect(WishlistsFlow.title(.reader(id: 2), readers: nil) == "Wishlist")
    }

    @Test func sublineCountsBooksAndForEveryoneTheWishlistsTheySitOn() {
        let list = readers([reader(1, "Sam", isYou: true, count: 3), reader(2, "Ada", count: 2), reader(3, "Ben")])
        #expect(WishlistsFlow.subline(.you, books: 1, readers: list) == "1 book")
        #expect(WishlistsFlow.subline(.you, books: 3, readers: list) == "3 books")
        #expect(WishlistsFlow.subline(.everyone, books: 3, readers: list) == "3 books across 2 wishlists")
        #expect(WishlistsFlow.subline(.everyone, books: 3, readers: nil) == "3 books")
        #expect(WishlistsFlow.subline(.everyone, books: 0, readers: list) == nil)
    }

    @Test func wantedByPutsOtherReadersFirstAndYouLast() {
        let wanters = [
            WishlistWanter(id: 1, name: "Sam"), WishlistWanter(id: 2, name: "Ada"), WishlistWanter(id: 3, name: "Ben"),
        ]
        #expect(WishlistsFlow.wantedBy(wanters, viewer: 1) == "Ada, Ben, you")
    }

    @Test func wantedBySaysYouAloneWhenOnlyTheViewerWantsIt() {
        #expect(WishlistsFlow.wantedBy([WishlistWanter(id: 1, name: "Sam")], viewer: 1) == "You")
        #expect(WishlistsFlow.wantedBy([WishlistWanter(id: 2, name: "Ada")], viewer: 1) == "Ada")
    }

    @Test func bylineJoinsAuthorsThenTheSeriesAndItsIndex() {
        var book = Book(id: 1, filename: "dune.epub")
        book.creators = [Contributor(name: "Frank Herbert"), Contributor(name: "Brian Herbert")]
        #expect(WishlistsFlow.byline(book) == "Frank Herbert, Brian Herbert")
        book.series = "Dune"
        #expect(WishlistsFlow.byline(book) == "Frank Herbert, Brian Herbert \u{b7} Dune")
        book.seriesIndex = "1"
        #expect(WishlistsFlow.byline(book) == "Frank Herbert, Brian Herbert \u{b7} Dune \u{b7} 1")
        #expect(WishlistsFlow.byline(Book(id: 2, filename: "x")) == "")
    }

    @Test func emptyCopyOffersAddOnYourListAndEveryonesButNotAnotherReaders() {
        let list = readers([reader(1, "Sam", isYou: true), reader(2, "Ada")])
        let you = WishlistsFlow.emptyCopy(.you, readers: list)
        #expect(you.title == "Nothing on your wishlist yet")
        #expect(you.offersAdd)
        let everyone = WishlistsFlow.emptyCopy(.everyone, readers: list)
        #expect(everyone.title == "No one has anything on their wishlist yet")
        #expect(everyone.offersAdd)
        let ada = WishlistsFlow.emptyCopy(.reader(id: 2), readers: list)
        #expect(ada.title == "Nothing on Ada\u{2019}s wishlist yet")
        #expect(!ada.offersAdd)
    }

    @Test func theWishlistsScreenKeepsTheTabBarUp() {
        #expect(!Destination.wishlists.hidesTabBar)
    }

    @Test(arguments: [
        ([], [WishlistRequestKind.ebook, .audiobook]),
        (["EPUB"], [.audiobook]),
        (["epub"], [.audiobook]),
        (["M4B"], [.ebook]),
        (["mp3"], [.ebook]),
        (["PRINT"], [.ebook, .audiobook]),
        (["EPUB", "M4B"], []),
    ] as [([String], [WishlistRequestKind])])
    func requestableOffersOnlyTheKindsTheLibraryLacks(formats: [String], kinds: [WishlistRequestKind]) {
        let holdings = formats.map { WishlistHolding(format: $0, count: 1) }
        #expect(WishlistsFlow.requestable(holdings) == kinds)
    }

    @Test func searchReadsAnIsbnAsALookupAndAnythingElseAsText() {
        #expect(WishlistsFlow.search(for: "   ") == .idle)
        #expect(WishlistsFlow.search(for: "978-0-441-17271-9") == .isbn("9780441172719"))
        #expect(WishlistsFlow.search(for: " 080442957x ") == .isbn("080442957X"))
        #expect(WishlistsFlow.search(for: "  Dune  ") == .text("Dune"))
        #expect(WishlistsFlow.search(for: "12345") == .text("12345"))
    }

    @Test func isbnResultsSplitsEachOutcomeIntoLibraryAndOnline() {
        let books = [scanBook("a"), scanBook("b")]
        let owned = WishlistsFlow.isbnResults(.alreadyOwned(book: books[0]))
        #expect(owned.library == [books[0]] && owned.online.isEmpty)
        let wished = WishlistsFlow.isbnResults(.onWishlist(book: books[0]))
        #expect(wished.library == [books[0]] && wished.online.isEmpty)
        let unowned = WishlistsFlow.isbnResults(.inLibraryUnowned(book: books[0]))
        #expect(unowned.library == [books[0]] && unowned.online.isEmpty)
        let close = WishlistsFlow.isbnResults(.closeMatch(books: books, scanned: meta()))
        #expect(close.library == books && close.online == [meta()])
        let missing = WishlistsFlow.isbnResults(.notInLibrary(online: meta()))
        #expect(missing.library.isEmpty && missing.online == [meta()])
        let unresolved = WishlistsFlow.isbnResults(.unresolved)
        #expect(unresolved.library.isEmpty && unresolved.online.isEmpty)
    }

    @Test func existingBookFindsTheLibraryBookAnOutcomeMatched() {
        let books = [scanBook("a"), scanBook("b")]
        #expect(WishlistsFlow.existingBook(.alreadyOwned(book: books[0]))?.uuid == "a")
        #expect(WishlistsFlow.existingBook(.onWishlist(book: books[0]))?.uuid == "a")
        #expect(WishlistsFlow.existingBook(.inLibraryUnowned(book: books[0]))?.uuid == "a")
        #expect(WishlistsFlow.existingBook(.closeMatch(books: books, scanned: meta()))?.uuid == "a")
        #expect(WishlistsFlow.existingBook(.notInLibrary(online: meta())) == nil)
        #expect(WishlistsFlow.existingBook(.unresolved) == nil)
    }

    @Test func onlineHeadingNamesTheProvidersThatAnsweredOnce() {
        #expect(WishlistsFlow.onlineHeading([]) == "From online providers")
        #expect(
            WishlistsFlow.onlineHeading([meta(source: "open_library"), meta(source: "open_library")])
                == "From Open Library"
        )
        #expect(
            WishlistsFlow.onlineHeading([meta(source: "open_library"), meta(source: "google_books")])
                == "From Open Library and Google Books"
        )
    }
}
