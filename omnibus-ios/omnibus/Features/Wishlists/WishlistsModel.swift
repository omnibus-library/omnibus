//  WishlistsModel.swift
//  The Wishlists screen's state: which reader's list is shown, what the last
//  read answered, and the reads themselves behind an injectable seam so the
//  decisions can be tested without a server.

import Foundation
import Observation

/// The calls the screen makes, as closures so tests can hand in a fake.
struct WishlistsAPI: Sendable {
    var readers: @Sendable () async throws -> WishlistReaders
    var books: @Sendable (WishlistScope) async throws -> [WishlistBook]

    static let live = WishlistsAPI(
        readers: { try await UserDataService.wishlistReaders() },
        books: { try await UserDataService.wishlists(scope: $0) }
    )
}

@Observable @MainActor
final class WishlistsModel {
    private(set) var scope: WishlistScope = .you
    private(set) var readers: WishlistReaders?
    /// Nil until the selected scope's list answers.
    private(set) var books: [WishlistBook]?
    private(set) var failure: String?

    private let api: WishlistsAPI

    init(api: WishlistsAPI = .live) {
        self.api = api
    }

    /// Reads the readers and the selected list together. A failed readers read
    /// leaves the picker at Everyone and You rather than failing the screen.
    func load() async {
        let requested = scope
        async let fetchedReaders = try? api.readers()
        do {
            let list = try await api.books(requested)
            if requested == scope {
                books = list
                failure = nil
            }
        } catch {
            if requested == scope { failure = Self.message(error) }
        }
        if let fetchedReaders = await fetchedReaders { readers = fetchedReaders }
    }

    func select(_ newScope: WishlistScope) async {
        guard newScope != scope else { return }
        scope = newScope
        books = nil
        failure = nil
        await load()
    }

    static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
