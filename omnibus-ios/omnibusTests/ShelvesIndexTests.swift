//  ShelvesIndexTests.swift
//  The shelves index's cuts: who owns what, the order, the filters, the census.
//  The web's `shelvesIndex.test.ts` pins the same arrangement.

import Foundation
import Testing

@testable import omnibus

private let viewer: Int64 = 1

private func shelf(
    _ id: Int64,
    _ name: String,
    owner: Int64 = viewer,
    ownerName: String = "me",
    kind: ShelfKind = .manual,
    visibility: ShelfVisibility = .private,
    books: Int64 = 0
) -> ShelfPreview {
    ShelfPreview(
        shelf: ShelfSummary(
            id: id, ownerUserId: owner, ownerUsername: ownerName, kind: kind,
            name: name, visibility: visibility, accent: nil, bookCount: books
        ),
        covers: []
    )
}

private let household = [
    shelf(1, "me's Wishlist", kind: .wishlist, visibility: .public),
    shelf(2, "Weekend reads", visibility: .public, books: 5),
    shelf(3, "compiler corner", books: 9),
    shelf(4, "Book club", owner: 3, ownerName: "zed", visibility: .public, books: 4),
    shelf(5, "Sea stories", owner: 2, ownerName: "Maya", kind: .smart, visibility: .public, books: 2),
]

struct ShelvesIndexTests {
    @Test func ownersPutsTheViewerFirstThenEveryoneByNameWithTheirCounts() {
        let owners = ShelvesIndex.owners(household.map(\.shelf), viewerId: viewer)
        #expect(owners.map(\.name) == ["me", "Maya", "zed"])
        #expect(owners.map(\.shelfCount) == [3, 1, 1])
        #expect(owners.first?.groupTitle == "Your shelves")
        #expect(owners[1].groupTitle == "Maya\u{2019}s shelves")
    }

    @Test func groupsOrdersByNameWithTheWishlistTrailing() {
        let groups = ShelvesIndex.groups(household, viewerId: viewer, query: ShelfQuery())
        #expect(groups.map(\.owner.id) == [1, 2, 3])
        #expect(groups[0].shelves.map(\.shelf.id) == [3, 2, 1])
    }

    @Test func groupsOrdersByBookCountWhenAskedAndStillTrailsTheWishlist() {
        let groups = ShelvesIndex.groups(household, viewerId: viewer, query: ShelfQuery(sort: .bookCount))
        #expect(groups[0].shelves.map(\.shelf.id) == [3, 2, 1])
        let reversed = household.map { preview in
            var preview = preview
            if preview.shelf.id == 2 { preview.shelf.bookCount = 20 }
            return preview
        }
        let regrouped = ShelvesIndex.groups(reversed, viewerId: viewer, query: ShelfQuery(sort: .bookCount))
        #expect(regrouped[0].shelves.map(\.shelf.id) == [2, 3, 1])
    }

    @Test func groupsMatchesEveryTermAgainstTheShelfOrItsOwnerAndDropsEmptyGroups() {
        let byOwner = ShelvesIndex.groups(household, viewerId: viewer, query: ShelfQuery(text: "maya"))
        #expect(byOwner.map(\.owner.id) == [2])
        let twoTerms = ShelvesIndex.groups(household, viewerId: viewer, query: ShelfQuery(text: "  CLUB zed "))
        #expect(twoTerms.flatMap(\.shelves).map(\.shelf.id) == [4])
    }

    @Test func groupsNarrowsByKindAndOwner() {
        let smart = ShelvesIndex.groups(household, viewerId: viewer, query: ShelfQuery(kind: .smart))
        #expect(smart.flatMap(\.shelves).map(\.shelf.id) == [5])
        let zed = ShelvesIndex.groups(household, viewerId: viewer, query: ShelfQuery(owner: 3))
        #expect(zed.map(\.owner.id) == [3])
        #expect(ShelfQuery(owner: 3).isFiltering)
        #expect(!ShelfQuery(text: "  ", sort: .bookCount).isFiltering)
    }

    @Test func censusCountsTheViewersShelvesAndTheOtherReaders() {
        let all = household.map(\.shelf)
        #expect(ShelvesIndex.census(all, viewerId: viewer) == "5 shelves · 3 yours · 2 other readers")
        #expect(ShelvesIndex.census(Array(all.prefix(1)), viewerId: viewer) == "1 shelf")
        #expect(ShelvesIndex.census(Array(all.suffix(1)), viewerId: viewer) == "1 shelf from 1 reader")
        #expect(ShelvesIndex.census([], viewerId: viewer) == "No shelves yet")
    }

    @Test func emptyMessageQuotesTheTextFilterWhenThereIsOne() {
        #expect(ShelvesIndex.emptyMessage(ShelfQuery(text: " gothic ")) == "No shelves match \u{201C}gothic\u{201D}.")
        #expect(ShelvesIndex.emptyMessage(ShelfQuery(kind: .smart)) == "No shelves match these filters.")
    }

    @Test func sortRoundTripsThroughDefaultsAndFallsBackOnAnUnknownValue() {
        let name = "omnibus.tests.shelvesSort.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        #expect(ShelvesSort.load(from: defaults) == .name)
        ShelvesSort.bookCount.save(to: defaults)
        #expect(ShelvesSort.load(from: defaults) == .bookCount)
        defaults.set("no_such_sort", forKey: ShelvesSort.defaultsKey)
        #expect(ShelvesSort.load(from: defaults) == .name)
    }
}
