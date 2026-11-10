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
    private var continuations: [CheckedContinuation<Void, Never>] = []
    private var isOpen = false

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuations.append($0) }
    }

    func open() {
        isOpen = true
        continuations.forEach { $0.resume() }
        continuations = []
    }
}

/// Numbers a fake's calls so it can answer the first differently from the rest.
actor CallCounter {
    private var count = 0

    func next() -> Int {
        count += 1
        return count
    }
}

func fakeAPI(
    readers: @escaping @Sendable () async throws -> WishlistReaders = { fakeReaders },
    books: @escaping @Sendable (WishlistScope) async throws -> [WishlistBook] = { _ in [] }
) -> WishlistsAPI {
    WishlistsAPI(
        readers: readers, books: books, remove: { _ in false }, add: { _ in },
        entry: { _ in nil }, addScanned: { _ in "new" }, resolveMeta: { _ in .unresolved }
    )
}

/// A wishlist that remembers what the model did to it, so reloads see the writes.
actor FakeWishlist {
    var list: [WishlistBook]
    var removed: [String] = []
    var added: [String] = []
    var removeResult: Result<Bool, Error> = .success(false)
    var addResult: Result<Void, Error> = .success(())
    var removeGate: Gate?
    var removeStarted: Gate?
    var listed: Set<String> = []
    var scanned: [WishlistAddRequest] = []
    var resolved: [ExternalBookMeta] = []
    var resolveOutcome: ScanOutcome = .unresolved
    var addScannedResult: Result<Void, Error> = .success(())
    var entryResult: Result<Void, Error> = .success(())
    var addScannedGate: Gate?
    var addScannedStarted: Gate?

    init(_ list: [WishlistBook]) {
        self.list = list
    }

    func failRemoves() { removeResult = .failure(FakeFailure()) }
    func failAdds() { addResult = .failure(FakeFailure()) }
    func deleteBookOnRemove() { removeResult = .success(true) }
    func alreadyListed(_ uuid: String) { listed.insert(uuid) }
    func resolveTo(_ outcome: ScanOutcome) { resolveOutcome = outcome }
    func failAddScanned() { addScannedResult = .failure(FakeFailure()) }
    func failEntry() { entryResult = .failure(FakeFailure()) }
    func holdAddScanned(started: Gate, until gate: Gate) { addScannedStarted = started; addScannedGate = gate }
    func holdRemoves(started: Gate, until gate: Gate) { removeStarted = started; removeGate = gate }

    nonisolated var api: WishlistsAPI {
        WishlistsAPI(
            readers: { fakeReaders },
            books: { _ in await self.list },
            remove: { try await self.remove($0) },
            add: { try await self.add($0) },
            entry: { try await self.entry($0) },
            addScanned: { try await self.addScanned($0) },
            resolveMeta: { await self.resolveMeta($0) }
        )
    }

    private func remove(_ uuid: String) async throws -> Bool {
        if let removeStarted, let removeGate {
            await removeStarted.open()
            await removeGate.wait()
        }
        removed.append(uuid)
        let result = try removeResult.get()
        list.removeAll { $0.id == uuid }
        return result
    }

    private func entry(_ uuid: String) throws -> WishlistEntry? {
        try entryResult.get()
        return listed.contains(uuid)
            ? WishlistEntry(id: 1, userID: 1, bookUUID: uuid, addedAt: 1, source: .detail) : nil
    }

    private func resolveMeta(_ meta: ExternalBookMeta) -> ScanOutcome {
        resolved.append(meta)
        return resolveOutcome
    }

    private func addScanned(_ request: WishlistAddRequest) async throws -> String {
        if let addScannedStarted, let addScannedGate {
            await addScannedStarted.open()
            await addScannedGate.wait()
        }
        try addScannedResult.get()
        scanned.append(request)
        let uuid = request.bookUUID ?? "minted"
        list.append(wishlistBook(uuid, title: request.meta?.title ?? "Dune"))
        return uuid
    }

    private func add(_ uuid: String) throws {
        try addResult.get()
        added.append(uuid)
        list.append(wishlistBook(uuid, title: uuid.uppercased()))
    }
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

    @Test func anOlderLoadFinishingAfterANewerOneIsIgnored() async {
        let started = Gate()
        let release = Gate()
        let calls = CallCounter()
        let model = WishlistsModel(
            api: fakeAPI(books: { _ in
                guard await calls.next() == 1 else { return [wishlistBook("new")] }
                await started.open()
                await release.wait()
                return [wishlistBook("old")]
            })
        )
        let older = Task { await model.load() }
        await started.wait()
        await model.load()
        await release.open()
        await older.value
        #expect(model.books == [wishlistBook("new")])
    }

    @Test func removeDropsTheRowAndOffersUndo() async {
        let fake = FakeWishlist([wishlistBook("a", title: "A"), wishlistBook("b", title: "B")])
        let model = WishlistsModel(api: fake.api)
        await model.load()
        await model.remove(wishlistBook("a", title: "A"))
        #expect(model.books?.map(\.id) == ["b"])
        #expect(model.toast?.text == "Removed A from your wishlist")
        #expect(model.toast?.undo == .readd(uuid: "a", title: "A"))
        #expect(await fake.removed == ["a"])
    }

    @Test func removeOffersNoUndoWhenTheBookWentWithItsLastEntry() async {
        let fake = FakeWishlist([wishlistBook("a", title: "A")])
        await fake.deleteBookOnRemove()
        let model = WishlistsModel(api: fake.api)
        await model.load()
        await model.remove(wishlistBook("a", title: "A"))
        #expect(model.toast?.text == "Removed A from your wishlist")
        #expect(model.toast?.undo == nil)
    }

    @Test func removeKeepsTheRowAndToastsTheErrorWhenItFails() async {
        let fake = FakeWishlist([wishlistBook("a", title: "A")])
        await fake.failRemoves()
        let model = WishlistsModel(api: fake.api)
        await model.load()
        await model.remove(wishlistBook("a", title: "A"))
        #expect(model.books?.map(\.id) == ["a"])
        #expect(model.toast?.text == "Couldn\u{2019}t remove A: boom")
        #expect(model.toast?.undo == nil)
    }

    @Test func aSecondRemoveOfTheSameBookIsIgnoredWhileTheFirstIsInFlight() async {
        let fake = FakeWishlist([wishlistBook("a", title: "A")])
        let started = Gate()
        let release = Gate()
        await fake.holdRemoves(started: started, until: release)
        let model = WishlistsModel(api: fake.api)
        await model.load()
        let first = Task { await model.remove(wishlistBook("a", title: "A")) }
        await started.wait()
        let second = Task { await model.remove(wishlistBook("a", title: "A")) }
        // Without the guard the second remove parks on the gate too; release once it has.
        try? await Task.sleep(for: .milliseconds(100))
        await release.open()
        await first.value
        await second.value
        #expect(await fake.removed == ["a"])
    }

    @Test func undoingARemovePutsTheBookBack() async throws {
        let fake = FakeWishlist([wishlistBook("a", title: "A")])
        let model = WishlistsModel(api: fake.api)
        await model.load()
        await model.remove(wishlistBook("a", title: "A"))
        await model.undo(try #require(model.toast))
        #expect(await fake.added == ["a"])
        #expect(model.books?.map(\.id) == ["a"])
        #expect(model.toast == nil)
    }

    @Test func undoToastsTheErrorWhenPuttingTheBookBackFails() async throws {
        let fake = FakeWishlist([wishlistBook("a", title: "A")])
        let model = WishlistsModel(api: fake.api)
        await model.load()
        await model.remove(wishlistBook("a", title: "A"))
        await fake.failAdds()
        await model.undo(try #require(model.toast))
        #expect(model.toast?.text == "Couldn\u{2019}t put A back: boom")
    }

    private let dune = ScanBook(
        uuid: "lib", title: "Dune", authors: ["Frank Herbert"], coverURL: nil, hasPhysical: false, isbn: nil
    )
    private let duneRecord = ExternalBookMeta(
        isbn13: "9780441172719", title: "Dune", authors: ["Frank Herbert"], year: nil, pages: nil,
        publisher: nil, description: nil, coverURL: nil, source: "open_library"
    )

    @Test func aSharedSearchHitBecomesTheWishlistHitOfTheSameKind() {
        #expect(WishlistHit(.library(dune, formats: ["EPUB"])) == .library(dune))
        #expect(WishlistHit(.online(duneRecord, lookup: nil)) == .online(duneRecord, lookup: nil))
        #expect(BookSearchHit.library(dune, formats: nil).title == "Dune")
    }

    @Test(arguments: [
        (FoundVia.barcodeScan, WishlistSource.scan),
        (.isbnEntry, .manual),
        (.titleSearch, .search),
    ])
    func addSendsALibraryHitByUuidWithTheDoorsSource(via: FoundVia, source: WishlistSource) async throws {
        let fake = FakeWishlist([])
        let model = WishlistsModel(api: fake.api)
        let failure = await model.add(.library(dune), via: via)
        let request = try #require(await fake.scanned.first)
        #expect(failure == nil)
        #expect(request.bookUUID == "lib")
        #expect(request.meta == nil)
        #expect(request.source == source)
    }

    @Test func addMatchesAnOnlineHitToALibraryBookBeforeSendingTheRecord() async throws {
        let fake = FakeWishlist([])
        await fake.resolveTo(.closeMatch(books: [dune], scanned: duneRecord))
        let model = WishlistsModel(api: fake.api)
        _ = await model.add(.online(duneRecord, lookup: nil), via: .titleSearch)
        let request = try #require(await fake.scanned.first)
        #expect(request.bookUUID == "lib")
        #expect(request.meta == nil)
        #expect(await fake.resolved == [duneRecord])
    }

    @Test func addSendsTheProviderRecordWhenNothingInTheLibraryMatches() async throws {
        let fake = FakeWishlist([])
        await fake.resolveTo(.notInLibrary(online: duneRecord))
        let model = WishlistsModel(api: fake.api)
        _ = await model.add(.online(duneRecord, lookup: nil), via: .titleSearch)
        let request = try #require(await fake.scanned.first)
        #expect(request.bookUUID == nil)
        #expect(request.meta == duneRecord)
    }

    @Test func addUsesTheIsbnLookupsMatchWithoutResolvingAgain() async throws {
        let fake = FakeWishlist([])
        let model = WishlistsModel(api: fake.api)
        _ = await model.add(.online(duneRecord, lookup: .inLibraryUnowned(book: dune)), via: .isbnEntry)
        let request = try #require(await fake.scanned.first)
        #expect(request.bookUUID == "lib")
        #expect(await fake.resolved.isEmpty)
    }

    @Test func addSaysAlreadyOnYourWishlistWithoutUndoWhenTheEntryExisted() async {
        let fake = FakeWishlist([])
        await fake.alreadyListed("lib")
        let model = WishlistsModel(api: fake.api)
        let failure = await model.add(.library(dune), via: .titleSearch)
        #expect(failure == nil)
        #expect(model.toast?.text == "Dune is already on your wishlist")
        #expect(model.toast?.undo == nil)
        #expect(await fake.scanned.isEmpty)
    }

    @Test func addSaysAlreadyOnYourWishlistWhenTheLookupFoundItThereWithoutReadingTheEntry() async {
        let fake = FakeWishlist([])
        let model = WishlistsModel(api: fake.api)
        let failure = await model.add(.online(duneRecord, lookup: .onWishlist(book: dune)), via: .isbnEntry)
        #expect(failure == nil)
        #expect(model.toast?.text == "Dune is already on your wishlist")
        #expect(await fake.scanned.isEmpty)
    }

    @Test func addStopsAndReturnsTheErrorWhenTheEntryReadFails() async {
        let fake = FakeWishlist([])
        await fake.failEntry()
        let model = WishlistsModel(api: fake.api)
        let failure = await model.add(.library(dune), via: .titleSearch)
        #expect(failure == "Couldn\u{2019}t add Dune: boom")
        #expect(await fake.scanned.isEmpty)
        #expect(model.toast == nil)
    }

    @Test func aSecondAddWhileOneIsInFlightIsRefusedWithoutWriting() async {
        let fake = FakeWishlist([])
        let started = Gate()
        let release = Gate()
        await fake.holdAddScanned(started: started, until: release)
        let model = WishlistsModel(api: fake.api)
        let first = Task { await model.add(.library(dune), via: .titleSearch) }
        await started.wait()
        let second = await model.add(.library(dune), via: .titleSearch)
        await release.open()
        _ = await first.value
        #expect(second == "Still adding the last book.")
        #expect(await fake.scanned.count == 1)
    }

    @Test func addClosesTheSheetWithoutWaitingForTheReloadItStarts() async {
        let reloadStarted = Gate()
        let release = Gate()
        let calls = CallCounter()
        let model = WishlistsModel(
            api: fakeAPI(books: { _ in
                if await calls.next() > 1 {
                    await reloadStarted.open()
                    await release.wait()
                }
                return []
            })
        )
        await model.load()
        let adding = Task { await model.add(.library(dune), via: .titleSearch) }
        await reloadStarted.wait()
        // The add is still waiting on the reload if it hasn't let go of the sheet.
        #expect(!model.isAdding)
        await release.open()
        #expect(await adding.value == nil)
    }

    @Test func addOffersUndoThatTakesTheNewEntryOff() async throws {
        let fake = FakeWishlist([])
        let model = WishlistsModel(api: fake.api)
        await model.load()
        _ = await model.add(.library(dune), via: .titleSearch)
        // The reload add starts is unawaited; wait for it to land.
        for _ in 0..<200 where model.books?.isEmpty != false { try? await Task.sleep(for: .milliseconds(10)) }
        #expect(model.toast?.text == "Added Dune to your wishlist")
        #expect(model.toast?.undo == .remove(uuid: "lib", title: "Dune"))
        #expect(model.books?.map(\.id) == ["lib"])
        await model.undo(try #require(model.toast))
        #expect(await fake.removed == ["lib"])
        #expect(model.books?.isEmpty == true)
        #expect(model.toast == nil)
    }

    @Test func addReturnsTheErrorAndLeavesNoToastWhenTheWriteFails() async {
        let fake = FakeWishlist([])
        await fake.failAddScanned()
        let model = WishlistsModel(api: fake.api)
        let failure = await model.add(.library(dune), via: .titleSearch)
        #expect(failure == "Couldn\u{2019}t add Dune: boom")
        #expect(model.toast == nil)
    }
}
