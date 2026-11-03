//  WishlistsModelTests.swift
//  The Wishlists view model against a hand-written fake of its API: what a
//  load shows, what a stale answer is allowed to change, and how removes and
//  adds settle.

import Foundation
import Testing

@testable import omnibus

struct FakeFailure: LocalizedError {
    var errorDescription: String? { "boom" }
}

func wishlistBook(_ uuid: String, title: String = "Book") -> WishlistBook {
    WishlistBook(
        book: Book(id: 1, filename: "\(uuid).epub", title: title, uniqueIdentifier: uuid),
        addedAt: 1_793_000_000,
        wantedBy: [WishlistWanter(id: 1, name: "Sam")],
        holdings: []
    )
}

let fakeReaders = WishlistReaders(
    everyone: 2,
    readers: [
        WishlistReader(id: 1, name: "Sam", hasAvatar: false, isYou: true, count: 1),
        WishlistReader(id: 2, name: "Ada", hasAvatar: false, isYou: false, count: 1),
    ]
)

/// Holds a fake's answer until the test lets it go.
actor Gate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var isOpen = false

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuation = $0 }
    }

    func open() {
        isOpen = true
        continuation?.resume()
        continuation = nil
    }
}

func fakeAPI(
    readers: @escaping @Sendable () async throws -> WishlistReaders = { fakeReaders },
    books: @escaping @Sendable (WishlistScope) async throws -> [WishlistBook] = { _ in [] }
) -> WishlistsAPI {
    WishlistsAPI(readers: readers, books: books)
}

@MainActor
struct WishlistsModelTests {
    @Test func loadShowsTheSelectedScopesBooksAndReaders() async {
        let model = WishlistsModel(api: fakeAPI(books: { _ in [wishlistBook("a")] }))
        await model.load()
        #expect(model.books == [wishlistBook("a")])
        #expect(model.readers == fakeReaders)
        #expect(model.failure == nil)
    }

    @Test func loadRecordsAFailureWhenTheBooksReadFails() async {
        let model = WishlistsModel(api: fakeAPI(books: { _ in throw FakeFailure() }))
        await model.load()
        #expect(model.books == nil)
        #expect(model.failure == "boom")
    }

    @Test func loadKeepsTheBooksWhenOnlyTheReadersReadFails() async {
        let model = WishlistsModel(
            api: fakeAPI(readers: { throw FakeFailure() }, books: { _ in [wishlistBook("a")] })
        )
        await model.load()
        #expect(model.books == [wishlistBook("a")])
        #expect(model.readers == nil)
        #expect(model.failure == nil)
    }

    @Test func selectAsksForTheNewScopesList() async {
        let model = WishlistsModel(
            api: fakeAPI(books: { scope in scope == .everyone ? [wishlistBook("all")] : [wishlistBook("mine")] })
        )
        await model.load()
        await model.select(.everyone)
        #expect(model.scope == .everyone)
        #expect(model.books == [wishlistBook("all")])
    }

    @Test func aBooksAnswerForAScopeNoLongerSelectedIsDropped() async {
        let started = Gate()
        let release = Gate()
        let model = WishlistsModel(
            api: fakeAPI(books: { scope in
                guard scope == .you else { return [wishlistBook("all")] }
                await started.open()
                await release.wait()
                return [wishlistBook("mine")]
            })
        )
        let first = Task { await model.load() }
        await started.wait()
        await model.select(.everyone)
        await release.open()
        await first.value
        #expect(model.books == [wishlistBook("all")])
    }
}
