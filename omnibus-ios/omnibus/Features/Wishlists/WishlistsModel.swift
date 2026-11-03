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
    /// Takes a book off your list; whether the book itself went with the entry.
    var remove: @Sendable (String) async throws -> Bool
    /// Puts a library book on your list.
    var add: @Sendable (String) async throws -> Void

    static let live = WishlistsAPI(
        readers: { try await UserDataService.wishlistReaders() },
        books: { try await UserDataService.wishlists(scope: $0) },
        remove: { try await UserDataService.removeWishlistEntry(uuid: $0) },
        add: { try await UserDataService.addWishlistEntry(uuid: $0) }
    )
}

/// A short message over the list, with an Undo when the write can be taken back.
struct WishlistToast: Identifiable, Equatable {
    enum Undo: Equatable {
        /// Undoes a remove.
        case readd(uuid: String, title: String)
    }

    let id = UUID()
    var text: String
    var undo: Undo?
}

@Observable @MainActor
final class WishlistsModel {
    private(set) var scope: WishlistScope = .you
    private(set) var readers: WishlistReaders?
    /// Nil until the selected scope's list answers.
    private(set) var books: [WishlistBook]?
    private(set) var failure: String?
    var toast: WishlistToast?
    /// Books with a remove in flight, so a second tap is ignored.
    private var removing: Set<String> = []

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

    /// Takes `item` off your list, then offers Undo unless the book went with it.
    func remove(_ item: WishlistBook) async {
        guard removing.insert(item.id).inserted else { return }
        defer { removing.remove(item.id) }
        let title = item.book.displayTitle
        do {
            let bookDeleted = try await api.remove(item.id)
            books?.removeAll { $0.id == item.id }
            toast = WishlistToast(
                text: "Removed \(title) from your wishlist",
                undo: bookDeleted ? nil : .readd(uuid: item.id, title: title)
            )
            await load()
        } catch {
            toast = WishlistToast(text: "Couldn\u{2019}t remove \(title): \(Self.message(error))")
        }
    }

    func undo(_ shown: WishlistToast) async {
        toast = nil
        guard let undo = shown.undo else { return }
        switch undo {
        case let .readd(uuid, title):
            do {
                try await api.add(uuid)
                await load()
            } catch {
                toast = WishlistToast(text: "Couldn\u{2019}t put \(title) back: \(Self.message(error))")
            }
        }
    }

    static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
