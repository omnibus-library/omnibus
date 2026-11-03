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
    /// Your entry for a book, nil when it isn't on your list.
    var entry: @Sendable (String) async throws -> WishlistEntry?
    /// Adds a library book or a provider record; the book's uuid.
    var addScanned: @Sendable (WishlistAddRequest) async throws -> String
    /// Matches a provider record against the library.
    var resolveMeta: @Sendable (ExternalBookMeta) async throws -> ScanOutcome

    static let live = WishlistsAPI(
        readers: { try await UserDataService.wishlistReaders() },
        books: { try await UserDataService.wishlists(scope: $0) },
        remove: { try await UserDataService.removeWishlistEntry(uuid: $0) },
        add: { try await UserDataService.addWishlistEntry(uuid: $0) },
        entry: { try await UserDataService.wishlistEntryNow(uuid: $0) },
        addScanned: { try await UserDataService.addScannedToWishlist($0) },
        resolveMeta: { try await APIClient.shared.post("/api/scan/resolve-meta", body: ResolveMetaRequest(meta: $0)) }
    )
}

/// A search hit the reader may add: a library book, or a provider's record of one.
enum WishlistHit: Equatable {
    case library(ScanBook)
    /// `lookup` is the ISBN outcome that surfaced the record; nil means resolve-meta first.
    case online(ExternalBookMeta, lookup: ScanOutcome?)

    var title: String {
        switch self {
        case let .library(book): book.title
        case let .online(meta, _): meta.title
        }
    }
}

/// A short message over the list, with an Undo when the write can be taken back.
struct WishlistToast: Identifiable, Equatable {
    enum Undo: Equatable {
        /// Undoes a remove.
        case readd(uuid: String, title: String)
        /// Undoes an add.
        case remove(uuid: String, title: String)
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
    private(set) var isAdding = false
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
        case let .remove(uuid, title):
            do {
                _ = try await api.remove(uuid)
                await load()
            } catch {
                toast = WishlistToast(text: "Couldn\u{2019}t undo adding \(title): \(Self.message(error))")
            }
        }
    }

    /// Nil on success (the sheet closes); otherwise the message the sheet shows.
    func add(_ hit: WishlistHit, via: FoundVia) async -> String? {
        guard !isAdding else { return "Still adding the last book." }
        isAdding = true
        defer { isAdding = false }
        let title = hit.title
        do {
            let request = try await request(for: hit, source: CheckInFlow.wishlistSource(via))
            // Undo must never take off an entry that predates this add, and a failed read stops the add.
            var alreadyListed = false
            if let uuid = request.bookUUID { alreadyListed = try await api.entry(uuid) != nil }
            let uuid = try await api.addScanned(request)
            toast = alreadyListed
                ? WishlistToast(text: "\(title) is already on your wishlist")
                : WishlistToast(text: "Added \(title) to your wishlist", undo: .remove(uuid: uuid, title: title))
            await load()
            return nil
        } catch {
            return "Couldn\u{2019}t add \(title): \(Self.message(error))"
        }
    }

    /// A provider's record that matches a library book goes against that book;
    /// only one that matches none is made into a new one.
    private func request(for hit: WishlistHit, source: WishlistSource) async throws -> WishlistAddRequest {
        switch hit {
        case let .library(book):
            return WishlistAddRequest(bookUUID: book.uuid, meta: nil, source: source)
        case let .online(meta, lookup):
            let outcome: ScanOutcome
            if let lookup { outcome = lookup } else { outcome = try await api.resolveMeta(meta) }
            if let found = WishlistsFlow.existingBook(outcome) {
                return WishlistAddRequest(bookUUID: found.uuid, meta: nil, source: source)
            }
            return WishlistAddRequest(bookUUID: nil, meta: meta, source: source)
        }
    }

    static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
