//  Wishlists.swift
//  Wire types for the household wishlist routes — the Swift side of the list
//  types in `omnibus_shared::physical` (`GET /api/wishlists`, `.../readers`).

import Foundation

/// One reader on `GET /api/wishlists/readers`, with how many books they want.
struct WishlistReader: Codable, Hashable, Sendable {
    var id: Int64
    var name: String
    var hasAvatar: Bool
    var isYou: Bool
    var count: Int64

    enum CodingKeys: String, CodingKey {
        case id, name, count
        case hasAvatar = "has_avatar"
        case isYou = "is_you"
    }
}

/// Every reader on the server and the size of their wishlists.
struct WishlistReaders: Codable, Hashable, Sendable {
    /// Distinct books on at least one wishlist.
    var everyone: Int64
    var readers: [WishlistReader]
}

/// A reader who wants a book.
struct WishlistWanter: Codable, Hashable, Sendable {
    var id: Int64
    var name: String
}

/// How many copies of a book the library holds in one kind (`PRINT` for physical).
struct WishlistHolding: Codable, Hashable, Sendable {
    var format: String
    var count: Int64
}

/// A book on a wishlist, as `GET /api/wishlists` lists it.
struct WishlistBook: Codable, Hashable, Sendable, Identifiable {
    var book: Book
    var addedAt: Int64
    var wantedBy: [WishlistWanter]
    /// Empty for a book the library only wants.
    var holdings: [WishlistHolding]

    var id: String { book.uuid }

    enum CodingKeys: String, CodingKey {
        case book, holdings
        case addedAt = "added_at"
        case wantedBy = "wanted_by"
    }
}
