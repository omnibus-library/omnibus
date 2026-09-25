//  SeriesStackMirrorTests.swift
//  Stack series served from the offline mirror: representatives over a real
//  scratch store, pages that never split a series, the filter bounding a
//  group, and series order.

import Foundation
import Testing

@testable import omnibus

private func book(_ id: Int64, _ title: String, series: String? = nil, index: String? = nil) -> Book {
    var b = Book(id: id, filename: "\(id).epub", title: title, uniqueIdentifier: "u\(id)")
    b.series = series
    b.seriesIndex = index
    return b
}

/// A scratch mirror holding `books`, promoted the way a sync pass does; returns it and its path.
private func mirror(_ books: [Book]) async throws -> (OfflineStore, String) {
    let path = FileManager.default.temporaryDirectory
        .appendingPathComponent("stack-mirror-\(UUID().uuidString).sqlite").path
    let store = OfflineStore(path: path)
    await store.open()
    let encoder = JSONEncoder()
    let rows = try books.map { LibraryIndex.row(for: $0, payload: try encoder.encode($0)) }
    await store.appendStagedBooks(rows)
    await store.promoteCompletedStaging()
    return (store, path)
}

private func read(
    _ store: OfflineStore, _ direction: SortDirection = .asc,
    filter: LibraryFilter = .none, limit: Int = 60, offset: Int = 0
) async -> (books: [Book], stacks: [SeriesStack]) {
    let (clause, bindings) = LibraryIndex.predicate(for: filter)
    return await LibraryIndex.stackedRead(
        from: store, clause: clause, bindings: bindings,
        order: LibraryIndex.order(sort: .title, direction: direction),
        limit: limit, offset: offset
    )
}

struct SeriesStackMirrorTests {
    private let library = [
        book(1, "Saga Two", series: "Saga", index: "2"),
        book(2, "Saga One", series: "Saga", index: "1"),
        book(3, "Lone"),
        book(4, "Solo", series: "Solo", index: "1"),
    ]

    @Test func foldsEachSeriesOntoItsFirstSortingMember() async throws {
        let (store, path) = try await mirror(library)
        defer { try? FileManager.default.removeItem(atPath: path) }

        let asc = await read(store)
        #expect(asc.books.map(\.displayTitle) == ["Lone", "Saga One", "Solo"])
        #expect(asc.stacks.map(\.leadUuid) == ["u2"])
        #expect(asc.stacks.first?.members.map(\.displayTitle) == ["Saga One", "Saga Two"])

        let desc = await read(store, .desc)
        #expect(desc.books.map(\.displayTitle) == ["Solo", "Saga Two", "Lone"])
        #expect(desc.stacks.map(\.leadUuid) == ["u1"])
    }

    @Test func stacksOnTheTrimmedCaseFoldedName() async throws {
        let (store, path) = try await mirror([
            book(1, "A", series: "Saga", index: "1"),
            book(2, "B", series: " saga ", index: "2"),
        ])
        defer { try? FileManager.default.removeItem(atPath: path) }

        let page = await read(store)
        #expect(page.books.map(\.displayTitle) == ["A"])
        #expect(page.stacks.first?.members.count == 2)
    }

    @Test func pagesByTileSoASeriesAppearsOnce() async throws {
        let (store, path) = try await mirror(library)
        defer { try? FileManager.default.removeItem(atPath: path) }

        let first = await read(store, limit: 2, offset: 0)
        let second = await read(store, limit: 2, offset: 2)
        #expect((first.books + second.books).map(\.displayTitle) == ["Lone", "Saga One", "Solo"])
    }

    @Test func aSeriesStacksOnlyWithTwoMembersInsideTheFilter() async throws {
        var audio = book(2, "Saga One", series: "Saga", index: "1")
        audio.formats = ["m4b"]
        var text = book(1, "Saga Two", series: "Saga", index: "2")
        text.formats = ["epub"]
        let (store, path) = try await mirror([audio, text])
        defer { try? FileManager.default.removeItem(atPath: path) }

        var filter = LibraryFilter()
        filter.formats = ["m4b"]
        let page = await read(store, filter: filter)
        #expect(page.books.map(\.displayTitle) == ["Saga One"])
        #expect(page.stacks.isEmpty)
    }

    @Test func ordersMembersByIndexWithTheUnnumberedLast() {
        let members = [
            book(1, "Extra", series: "Saga"),
            book(2, "Two", series: "Saga", index: "2"),
            book(3, "One", series: "Saga", index: "1"),
        ]
        let stacks = LibraryIndex.stacks(reps: [members[1]], members: members)
        #expect(stacks.first?.leadUuid == "u2")
        #expect(stacks.first?.members.map(\.displayTitle) == ["One", "Two", "Extra"])
    }
}
