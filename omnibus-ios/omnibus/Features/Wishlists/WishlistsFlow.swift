//  WishlistsFlow.swift
//  The Wishlists screen's pure decisions: whose list is shown, how it is
//  titled and described, and what each row says. Mirrors the web client's
//  `wishlistView.ts` so both read a list the same way.

import Foundation

/// Whose wishlist the screen shows.
enum WishlistScope: Hashable, Sendable {
    case everyone, you
    case reader(id: Int64)

    /// The `user` query value; nil for your own list.
    var userParam: String? {
        switch self {
        case .you: nil
        case .everyone: "all"
        case let .reader(id): String(id)
        }
    }
}

/// One Request or View row on a book's Get sheet.
struct WishlistRequestItem: Equatable {
    enum Action: Equatable {
        /// Starts a request, then opens its page.
        case request
        /// Opens the request that is going.
        case view
    }

    var kind: RequestKind
    var action: Action
    var title: String
    var detail: String
}

/// What the Add sheet's field asks for.
enum WishlistSearch: Equatable {
    case idle
    /// Hyphens and spaces stripped.
    case isbn(String)
    case text(String)
}

enum WishlistsFlow {
    private static let audioFormats: Set<String> = ["M4B", "M4A", "MP3"]

    /// The kinds the library lacks: audio is M4B, M4A or MP3, any other
    /// digital format is an ebook, and print counts as neither.
    static func requestable(_ holdings: [WishlistHolding]) -> [RequestKind] {
        let formats = holdings.map { $0.format.uppercased() }
        var kinds: [RequestKind] = []
        if !formats.contains(where: { $0 != "PRINT" && !audioFormats.contains($0) }) { kinds.append(.ebook) }
        if !formats.contains(where: audioFormats.contains) { kinds.append(.audiobook) }
        return kinds
    }

    /// The Get sheet's request rows, ebook then audiobook: View where a request is going for the kind (to
    /// any reader, since viewing needs no permission), else Request for a kind the library lacks and only
    /// to a reader who may start one.
    static func requestItems(
        holdings: [WishlistHolding], canStart: Bool, live: [RequestKind: RequestState]
    ) -> [WishlistRequestItem] {
        let lacking = requestable(holdings)
        return RequestKind.allCases.compactMap { kind in
            if let state = live[kind] {
                return WishlistRequestItem(
                    kind: kind, action: .view, title: "View \(kind.rawValue) request",
                    detail: BookRequestFlow.stateView(state, kind: kind).heading)
            }
            guard canStart, lacking.contains(kind) else { return nil }
            return WishlistRequestItem(
                kind: kind, action: .request, title: "Request \(kind.rawValue)", detail: "Opens its request page")
        }
    }

    /// Each book's kinds with a request going, by uuid, at the newest one's state. `listings` come newest first.
    static func liveRequests(_ listings: [RequestListing]) -> [String: [RequestKind: RequestState]] {
        var live: [String: [RequestKind: RequestState]] = [:]
        for listing in listings where BookRequestFlow.isLive(listing.request.state) {
            let (uuid, kind) = (listing.book.uuid, listing.request.kind)
            if live[uuid]?[kind] == nil { live[uuid, default: [:]][kind] = listing.request.state }
        }
        return live
    }

    /// Everyone, you, then every other reader in server order. The server's
    /// `is_you` row is dropped — `.you` already stands for it.
    static func pickerOptions(from readers: WishlistReaders?) -> [WishlistScope] {
        let others = readers?.readers.filter { !$0.isYou }.map { WishlistScope.reader(id: $0.id) } ?? []
        return [.everyone, .you] + others
    }

    static func reader(_ scope: WishlistScope, in readers: WishlistReaders?) -> WishlistReader? {
        guard case let .reader(id) = scope else { return nil }
        return readers?.readers.first { $0.id == id }
    }

    static func menuLabel(_ scope: WishlistScope, readers: WishlistReaders?) -> String {
        switch scope {
        case .everyone: "Everyone"
        case .you: "You"
        case .reader: reader(scope, in: readers)?.name ?? "Reader"
        }
    }

    static func title(_ scope: WishlistScope, readers: WishlistReaders?) -> String {
        switch scope {
        case .you: "Your Wishlist"
        case .everyone: "Everyone\u{2019}s Wishlists"
        case .reader:
            reader(scope, in: readers).map { "\($0.name)\u{2019}s Wishlist" } ?? "Wishlist"
        }
    }

    /// "3 books", or for Everyone "3 books across 2 wishlists" once the
    /// readers have answered. Nil for an empty list.
    static func subline(_ scope: WishlistScope, books: Int, readers: WishlistReaders?) -> String? {
        guard books > 0 else { return nil }
        let count = StatsFormat.counted(Int64(books), "book")
        guard scope == .everyone, let readers else { return count }
        let wishlists = readers.readers.filter { $0.count > 0 }.count
        return "\(count) across \(StatsFormat.counted(Int64(wishlists), "wishlist"))"
    }

    /// The other readers by name, then "you" last; "You" alone when only the viewer wants it.
    static func wantedBy(_ wanters: [WishlistWanter], viewer: Int64?) -> String {
        let others = wanters.filter { $0.id != viewer }.map(\.name)
        if others.count == wanters.count { return others.joined(separator: ", ") }
        return others.isEmpty ? "You" : others.joined(separator: ", ") + ", you"
    }

    /// "Wanted by Ada, you" on Everyone's list, else "Added Oct 30, 2026".
    static func meta(_ item: WishlistBook, scope: WishlistScope, viewer: Int64?) -> String {
        scope == .everyone
            ? "Wanted by \(wantedBy(item.wantedBy, viewer: viewer))"
            : "Added \(Format.date(unix: item.addedAt))"
    }

    /// Authors, then the series and its index, joined by " · ".
    static func byline(_ book: Book) -> String {
        let authors = book.creators.map(\.name).filter { !$0.isEmpty }.joined(separator: ", ")
        var parts = [authors]
        if let series = book.series?.nilIfBlank {
            parts.append(series)
            if let index = book.seriesIndex?.nilIfBlank { parts.append(index) }
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " \u{b7} ")
    }

    struct EmptyCopy: Equatable {
        var title: String
        var message: String
        /// Whether the empty state offers "Add to your wishlist".
        var offersAdd: Bool
    }

    static func emptyCopy(_ scope: WishlistScope, readers: WishlistReaders?) -> EmptyCopy {
        switch scope {
        case .you:
            return EmptyCopy(
                title: "Nothing on your wishlist yet",
                message: "Search by title, author or ISBN, or add it from any book\u{2019}s page. Everyone in the household can see your wishlist.",
                offersAdd: true
            )
        case .everyone:
            return EmptyCopy(
                title: "No one has anything on their wishlist yet",
                message: "When someone in the household adds a book to their wishlist, it shows up here, so you can find or request it for them. Start with yours.",
                offersAdd: true
            )
        case .reader:
            let name = reader(scope, in: readers)?.name ?? "They"
            return EmptyCopy(
                title: "Nothing on \(name)\u{2019}s wishlist yet",
                message: "When \(name) adds a book to their wishlist, it shows up here.",
                offersAdd: false
            )
        }
    }

    // MARK: - Add to your wishlist

    static func search(for text: String) -> WishlistSearch {
        guard let trimmed = text.nilIfBlank else { return .idle }
        guard MetadataFetchFlow.looksLikeISBN(trimmed) else { return .text(trimmed) }
        return .isbn(trimmed.filter { $0.isNumber || $0 == "X" || $0 == "x" }.uppercased())
    }

    /// Only the camera is a scan; a typed ISBN is manual and a title search is neither.
    static func foundVia(_ search: WishlistSearch, scanned: String?) -> FoundVia {
        guard case .isbn = search else { return .titleSearch }
        return scanned.map(Self.search(for:)) == search ? .barcodeScan : .isbnEntry
    }

    /// What an ISBN lookup puts under "In your library" and under the providers' name.
    static func isbnResults(_ outcome: ScanOutcome) -> (library: [ScanBook], online: [ExternalBookMeta]) {
        switch outcome {
        case let .alreadyOwned(book), let .onWishlist(book), let .inLibraryUnowned(book):
            ([book], [])
        case let .closeMatch(books, scanned): (books, [scanned])
        case let .notInLibrary(online): ([], [online])
        case .unresolved: ([], [])
        }
    }

    /// The heading over the providers' results: whichever answered.
    static func onlineHeading(_ online: [ExternalBookMeta]) -> String {
        var names: [String] = []
        for meta in online {
            let name = MetadataProvider(rawValue: meta.source).displayName
            if !names.contains(name) { names.append(name) }
        }
        return names.isEmpty ? "From online providers" : "From " + names.joined(separator: " and ")
    }
}
