//  ShelvesIndex.swift
//  What the shelves index shows: filtered, grouped by owner, ordered, counted.
//
//  The web's `shelvesIndex.ts` makes the same cuts, and the two must agree —
//  the viewer's shelves first, everyone else's by name, the Wishlist trailing
//  each group — so a household sees one arrangement on every client. Pure
//  functions over `ShelfSummary`, so the screen stays layout and the rules
//  stay testable.

import Foundation

/// The kind toggle's options, in toolbar order.
enum ShelfKindFilter: String, CaseIterable, Identifiable, Sendable {
    case any, smart, manual, wishlist

    var id: Self { self }

    var label: String {
        switch self {
        case .any: "All"
        case .smart: "Smart"
        case .manual: "Hand-picked"
        case .wishlist: "Wishlists"
        }
    }

    func admits(_ kind: ShelfKind) -> Bool {
        switch self {
        case .any: true
        case .smart: kind == .smart
        case .manual: kind == .manual
        case .wishlist: kind == .wishlist
        }
    }
}

/// How each owner's shelves are ordered.
enum ShelvesSort: String, CaseIterable, Identifiable, Sendable {
    case name
    case bookCount = "book_count"

    var id: Self { self }

    var label: String {
        switch self {
        case .name: "A–Z"
        case .bookCount: "Most books"
        }
    }

    static let defaultsKey = "omnibus.shelves.sort"

    /// The saved order, or A–Z when none is saved or the build no longer knows it.
    static func load(from defaults: UserDefaults = .standard) -> ShelvesSort {
        defaults.string(forKey: defaultsKey).flatMap(ShelvesSort.init(rawValue:)) ?? .name
    }

    func save(to defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.defaultsKey)
    }
}

/// Everything that narrows or orders the index; `owner` is nil for everyone.
struct ShelfQuery: Equatable, Sendable {
    var text = ""
    var owner: Int64?
    var kind: ShelfKindFilter = .any
    var sort: ShelvesSort = .name

    /// Whether anything but the order hides shelves.
    var isFiltering: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || owner != nil || kind != .any
    }
}

/// Someone with at least one visible shelf.
struct ShelfOwner: Identifiable, Equatable, Sendable {
    let id: Int64
    let name: String
    let hasAvatar: Bool
    let isViewer: Bool
    /// How many visible shelves they own, before any filter.
    var shelfCount: Int

    /// A group's heading.
    var groupTitle: String { isViewer ? "Your shelves" : "\(name)\u{2019}s shelves" }
    /// What a chip or a tile's foot calls them.
    var shortName: String { isViewer ? "You" : name }
}

struct ShelfOwnerGroup: Identifiable, Sendable {
    let owner: ShelfOwner
    let shelves: [ShelfPreview]

    var id: Int64 { owner.id }
}

enum ShelvesIndex {
    /// Every owner in `all`: the viewer first, then everyone else by name.
    static func owners(_ all: [ShelfSummary], viewerId: Int64?) -> [ShelfOwner] {
        var byId: [Int64: ShelfOwner] = [:]
        for shelf in all {
            if byId[shelf.ownerUserId] != nil {
                byId[shelf.ownerUserId]?.shelfCount += 1
            } else {
                byId[shelf.ownerUserId] = ShelfOwner(
                    id: shelf.ownerUserId,
                    name: shelf.ownerUsername,
                    hasAvatar: shelf.ownerHasAvatar ?? false,
                    isViewer: shelf.ownerUserId == viewerId,
                    shelfCount: 1
                )
            }
        }
        return byId.values.sorted { a, b in
            if a.isViewer != b.isViewer { return a.isViewer }
            let (an, bn) = (a.name.lowercased(), b.name.lowercased())
            return an != bn ? an < bn : a.id < b.id
        }
    }

    /// Whether every whitespace-separated term of `text` is in the shelf's or its owner's name.
    static func matches(_ shelf: ShelfSummary, text: String) -> Bool {
        let haystack = "\(shelf.name) \(shelf.ownerUsername)".lowercased()
        return text.split(whereSeparator: \.isWhitespace)
            .allSatisfy { haystack.contains($0.lowercased()) }
    }

    /// `all` filtered by `query`, grouped by owner (viewer first) and ordered by
    /// `query.sort`; an owner left with nothing drops out.
    static func groups(_ all: [ShelfPreview], viewerId: Int64?, query: ShelfQuery) -> [ShelfOwnerGroup] {
        owners(all.map(\.shelf), viewerId: viewerId)
            .filter { query.owner == nil || query.owner == $0.id }
            .compactMap { owner in
                let shelves = all
                    .filter {
                        $0.shelf.ownerUserId == owner.id
                            && query.kind.admits($0.shelf.kind)
                            && matches($0.shelf, text: query.text)
                    }
                    .sorted { inGroupOrder($0.shelf, $1.shelf, sort: query.sort) }
                return shelves.isEmpty ? nil : ShelfOwnerGroup(owner: owner, shelves: shelves)
            }
    }

    // The Wishlist trails under either order: it is the one shelf nobody curated.
    private static func inGroupOrder(_ a: ShelfSummary, _ b: ShelfSummary, sort: ShelvesSort) -> Bool {
        if (a.kind == .wishlist) != (b.kind == .wishlist) { return b.kind == .wishlist }
        if sort == .bookCount, a.bookCount != b.bookCount { return a.bookCount > b.bookCount }
        let (an, bn) = (a.name.lowercased(), b.name.lowercased())
        return an != bn ? an < bn : a.id < b.id
    }

    /// The header's census: how many shelves, how many are the viewer's, and
    /// how many other readers own the rest.
    static func census(_ all: [ShelfSummary], viewerId: Int64?) -> String {
        guard !all.isEmpty else { return "No shelves yet" }
        let total = counted(all.count, "shelf", "shelves")
        let yours = all.filter { $0.ownerUserId == viewerId }.count
        let others = all.count - yours
        let readers = owners(all, viewerId: viewerId).filter { !$0.isViewer }.count
        // Every shelf the viewer's: the group heading already says so.
        if others == 0 { return total }
        if yours == 0 { return "\(total) from \(counted(readers, "reader", "readers"))" }
        return "\(total) · \(yours) yours · \(counted(readers, "other reader", "other readers"))"
    }

    /// What the body says when no tile survives the filter.
    static func emptyMessage(_ query: ShelfQuery) -> String {
        let text = query.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "No shelves match these filters." : "No shelves match \u{201C}\(text)\u{201D}."
    }

    private static func counted(_ n: Int, _ one: String, _ many: String) -> String {
        n == 1 ? "1 \(one)" : "\(n) \(many)"
    }
}
