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
    /// Every reader's requests, newest first.
    var requests: @Sendable () async throws -> [RequestListing]
    /// Starts a request of a kind on a library book.
    var startRequest: @Sendable (String, RequestKind) async throws -> BookRequest

    static let live = WishlistsAPI(
        readers: { try await UserDataService.wishlistReaders() },
        books: { try await UserDataService.wishlists(scope: $0) },
        remove: { try await UserDataService.removeWishlistEntry(uuid: $0) },
        add: { try await UserDataService.addWishlistEntry(uuid: $0) },
        entry: { try await UserDataService.wishlistEntryNow(uuid: $0) },
        addScanned: { try await UserDataService.addScannedToWishlist($0) },
        resolveMeta: { try await APIClient.shared.post("/api/scan/resolve-meta", body: ResolveMetaRequest(meta: $0)) },
        requests: { try await RequestService.list() },
        startRequest: { try await RequestService.start(bookUUID: $0, kind: $1) }
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

extension WishlistHit {
    init(_ hit: BookSearchHit) {
        switch hit {
        case let .library(book, _): self = .library(book)
        case let .online(meta, lookup): self = .online(meta, lookup: lookup)
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
    /// Whether the server has book requests on, so a load reads them. Set by the screen.
    var readsRequests = false
    /// Each book's kinds with a request going; empty where the read failed or requests are off.
    private(set) var liveRequests: [String: [RequestKind: RequestState]] = [:]
    private var isStartingRequest = false
    /// Books with a remove in flight, so a second tap is ignored.
    private var removing: Set<String> = []
    /// Numbers each load so only the newest one's answer is applied.
    private var loadGeneration = 0

    private let api: WishlistsAPI

    init(api: WishlistsAPI = .live) {
        self.api = api
    }

    /// Reads the readers and the selected list together. A failed readers read
    /// leaves the picker at Everyone and You rather than failing the screen.
    func load() async {
        let requested = scope
        loadGeneration += 1
        let generation = loadGeneration
        async let fetchedReaders = try? api.readers()
        async let fetchedRequests = readRequests()
        do {
            let list = try await api.books(requested)
            if requested == scope, generation == loadGeneration {
                books = list
                failure = nil
            }
        } catch {
            if requested == scope, generation == loadGeneration { failure = Self.message(error) }
        }
        if let fetchedReaders = await fetchedReaders, generation == loadGeneration { readers = fetchedReaders }
        let requests = await fetchedRequests
        if generation == loadGeneration, readsRequests { liveRequests = requests }
    }

    /// A failed read leaves the Get sheet with only its Request rows.
    private func readRequests() async -> [String: [RequestKind: RequestState]] {
        guard readsRequests, let listings = try? await api.requests() else { return [:] }
        return WishlistsFlow.liveRequests(listings)
    }

    /// Starts a request; true when it stands, so the screen can open its page. A refusal toasts why,
    /// and a start while another runs is ignored with a toast, unless an Undo is open.
    func startRequest(uuid: String, kind: RequestKind) async -> Bool {
        guard !isStartingRequest else {
            if toast?.undo == nil { toast = WishlistToast(text: "Still starting the last request.") }
            return false
        }
        isStartingRequest = true
        defer { isStartingRequest = false }
        do {
            let started = try await api.startRequest(uuid, kind)
            if BookRequestFlow.isLive(started.state) { liveRequests[uuid, default: [:]][kind] = started.state }
            return true
        } catch {
            toast = WishlistToast(text: BookRequestFlow.startFailure(error))
            return false
        }
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
            let (request, onWishlist) = try await request(for: hit, via: via)
            // Undo must never take off an entry that predates this add, and a failed read stops the add.
            var alreadyListed = onWishlist
            if !alreadyListed, let uuid = request.bookUUID { alreadyListed = try await api.entry(uuid) != nil }
            if alreadyListed {
                toast = WishlistToast(text: "\(title) is already on your wishlist")
                return nil
            }
            let uuid = try await api.addScanned(request)
            toast = WishlistToast(text: "Added \(title) to your wishlist", undo: .remove(uuid: uuid, title: title))
            // Unawaited so the sheet closes now, not behind a toast that is already counting down.
            Task { await load() }
            return nil
        } catch {
            return "Couldn\u{2019}t add \(title): \(Self.message(error))"
        }
    }

    /// A provider's record that matches a library book goes against that book;
    /// only one that matches none is made into a new one. `onWishlist` is true
    /// when the lookup itself says the book is already on your list.
    private func request(
        for hit: WishlistHit, via: FoundVia
    ) async throws -> (request: WishlistAddRequest, onWishlist: Bool) {
        switch hit {
        case let .library(book):
            return (WishlistAddRequest(bookUUID: book.uuid, meta: nil, source: CheckInFlow.wishlistSource(via)), false)
        case let .online(meta, lookup):
            let outcome: ScanOutcome
            if let lookup { outcome = lookup } else { outcome = try await api.resolveMeta(meta) }
            if let found = WishlistsFlow.isbnResults(outcome).library.first {
                let request = WishlistAddRequest(bookUUID: found.uuid, meta: nil, source: CheckInFlow.wishlistSource(via))
                if case .onWishlist = outcome { return (request, true) }
                return (request, false)
            }
            return (CheckInFlow.wishlistRequest(meta: meta, foundVia: via), false)
        }
    }

    static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
