//  WishlistsCodecTests.swift
//  The wishlist routes' wire contract with `omnibus_shared::physical`, decoded
//  from JSON literals copied from the Rust types so drift fails here.

import Foundation
import Testing

@testable import omnibus

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

struct WishlistsCodecTests {
    @Test func wishlistBookDecodesTheBookHoldingsAndWanters() throws {
        let wishlistBook = try decode(
            WishlistBook.self,
            """
            {"book":{"id":4,"filename":"dune.epub","title":"Dune","unique_identifier":"u-dune",
             "creators":[{"name":"Frank Herbert"}],"series":"Dune","series_index":"1",
             "isbn13":"9780441172719","formats":["EPUB"]},
             "added_at":1793000000,
             "wanted_by":[{"id":2,"name":"Ada"},{"id":3,"name":"Ben"}],
             "holdings":[{"format":"EPUB","count":1},{"format":"PRINT","count":2}]}
            """
        )
        #expect(wishlistBook.id == "u-dune")
        #expect(wishlistBook.book.displayTitle == "Dune")
        #expect(wishlistBook.addedAt == 1_793_000_000)
        #expect(wishlistBook.wantedBy.map(\.name) == ["Ada", "Ben"])
        #expect(wishlistBook.holdings == [
            WishlistHolding(format: "EPUB", count: 1), WishlistHolding(format: "PRINT", count: 2),
        ])
    }

    @Test func wishlistBookDecodesAnEmptyHoldingsListForABookTheLibraryOnlyWants() throws {
        let wishlistBook = try decode(
            WishlistBook.self,
            """
            {"book":{"id":9,"filename":"x","title":"Wanted","unique_identifier":"u-w"},
             "added_at":1,"wanted_by":[{"id":1,"name":"You"}],"holdings":[]}
            """
        )
        #expect(wishlistBook.holdings.isEmpty)
    }

    @Test func wishlistReadersDecodesEveryoneAndEachReadersCount() throws {
        let readers = try decode(
            WishlistReaders.self,
            """
            {"everyone":5,"readers":[
              {"id":1,"name":"Sam","has_avatar":true,"is_you":true,"count":3},
              {"id":2,"name":"Ada","has_avatar":false,"is_you":false,"count":0}]}
            """
        )
        #expect(readers.everyone == 5)
        #expect(readers.readers.map(\.count) == [3, 0])
        #expect(readers.readers[0].isYou)
        #expect(readers.readers[0].hasAvatar)
        #expect(!readers.readers[1].isYou)
    }
}
