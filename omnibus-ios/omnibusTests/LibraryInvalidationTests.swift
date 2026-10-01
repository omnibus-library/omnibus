//  LibraryInvalidationTests.swift
//  The Library home re-reads what a write moved: which rails a write kind
//  announces (by the outbox's own scope), what marking a book does to the
//  cached Continue rail, and when a shelf read means the shelf is gone.

import Foundation
import Testing

@testable import omnibus

private func point(_ uuid: String, _ format: ProgressFormat = .epub) -> ResumePoint {
    ResumePoint(
        record: ProgressRecord(
            bookUUID: uuid, format: format, epubCFI: nil, audioPositionSeconds: nil,
            updatedAt: 1_700_000_000, clientUpdatedAt: 1_700_000_000
        ),
        book: Book(id: 1, filename: "\(uuid).epub", title: uuid, uniqueIdentifier: uuid),
        audioPart: nil, audioPartCount: nil
    )
}

@MainActor
struct ReplicaInvalidationsTests {
    @Test("a read-status write moves the Continue rail, not the shelves")
    func readStatusAnnouncesTheContinueRail() {
        let hub = ReplicaInvalidations()
        hub.note(kind: OpKind.readStatus("b-1"))
        #expect(hub.generation(of: CacheKey.recentProgress) == 1)
        #expect(hub.generation(of: CacheKey.shelfPreviews) == 0)
    }

    @Test("a read-status write moves the summary Search's Recently finished rail reads")
    func readStatusAnnouncesTheFinishedRail() {
        let hub = ReplicaInvalidations()
        hub.note(kind: OpKind.readStatus("b-1"))
        #expect(hub.generation(of: CacheKey.stats(.allTime)) == 1)
    }

    @Test("a shelf delete or membership write moves the Shelves rail")
    func shelfWriteAnnouncesTheShelvesRail() {
        let hub = ReplicaInvalidations()
        hub.note(kind: OpKind.shelfMembership)
        #expect(hub.generation(of: CacheKey.shelfPreviews) == 1)
        #expect(hub.generation(of: CacheKey.recentProgress) == 0)
    }

    @Test("a write the home shows nothing of announces nothing")
    func unrelatedWritesStayQuiet() {
        let hub = ReplicaInvalidations()
        hub.note(kind: OpKind.highlight)
        hub.note(kind: OpKind.session)
        hub.note(kind: OpKind.rating("b-1"))
        #expect(hub.generation(of: CacheKey.recentProgress) == 0)
        #expect(hub.generation(of: CacheKey.shelfPreviews) == 0)
    }

    @Test("an undeclared kind moves every watched key, as the outbox's scope does")
    func unknownKindsAreOverCautious() {
        let hub = ReplicaInvalidations()
        hub.note(kind: "something_new")
        #expect(hub.generation(of: CacheKey.recentProgress) == 1)
        #expect(hub.generation(of: CacheKey.shelfPreviews) == 1)
    }

    @Test("every announcement counts, so two writes are never read as one")
    func generationsAccumulate() {
        let hub = ReplicaInvalidations()
        hub.note(kind: OpKind.shelfMembership)
        hub.note(keys: [CacheKey.shelfPreviews])
        #expect(hub.generation(of: CacheKey.shelfPreviews) == 2)
    }
}

struct ContinueRailMarkingTests {
    @Test("marking a book finished takes every card of it off the rail")
    func finishedLeavesTheRail() {
        let rail = [point("b-1", .epub), point("b-2"), point("b-1", .audio)]
        let after = UserDataService.resumePoints(rail, marking: "b-1", as: .finished)
        #expect(after.map(\.record.bookUUID) == ["b-2"])
    }

    @Test("marking a book unread takes it off too — the server's rail omits both")
    func unreadLeavesTheRail() {
        let after = UserDataService.resumePoints([point("b-1"), point("b-2")], marking: "b-2", as: .unread)
        #expect(after.map(\.record.bookUUID) == ["b-1"])
    }

    @Test("marking a book reading leaves the rail as it was")
    func readingKeepsTheRail() {
        let rail = [point("b-1"), point("b-2")]
        #expect(
            UserDataService.resumePoints(rail, marking: "b-1", as: .reading).map(\.id)
                == rail.map(\.id)
        )
    }
}

struct ShelfGoneTests {
    @Test("a 404 means the shelf is gone")
    func notFoundIsGone() {
        #expect(ShelfDetailView.isGone(APIError.http(status: 404, message: "")))
    }

    @Test("an unreachable server or a server error is not proof it's gone")
    func otherFailuresAreNotGone() {
        #expect(!ShelfDetailView.isGone(APIError.offline))
        #expect(!ShelfDetailView.isGone(APIError.http(status: 500, message: "")))
        #expect(!ShelfDetailView.isGone(APIError.transport("timed out")))
    }
}
