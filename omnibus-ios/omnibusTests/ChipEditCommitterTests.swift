//  ChipEditCommitterTests.swift
//  The chip editor's save policy: requests for one list leave in tap order,
//  only the newest answer is painted while a superseded success still
//  reaches the replica, and a refused save resyncs before it reverts.

import Foundation
import Testing

@testable import omnibus

@MainActor
struct ChipEditCommitterTests {
    private func book(tags: [String]) -> Book {
        var book = Book(id: 7, filename: "book.epub")
        book.subjects = tags
        return book
    }

    /// A save that records every list it was asked to file, in order, and
    /// holds the first one open until the test releases it.
    @MainActor
    private final class Recorder {
        var filed: [[String]] = []
        var persisted: [[String]] = []
        private var release: CheckedContinuation<Void, Never>?

        func save(_ values: [String]) async -> Book {
            filed.append(values)
            if filed.count == 1 {
                await withCheckedContinuation { release = $0 }
            }
            var book = Book(id: 7, filename: "book.epub")
            book.subjects = values
            return book
        }

        func releaseFirst() {
            release?.resume()
            release = nil
        }
    }

    private func settle(until condition: @MainActor () -> Bool) async {
        for _ in 0..<500 where !condition() {
            try? await Task.sleep(for: .milliseconds(2))
        }
    }

    @Test func savesLeaveInTapOrderAndOnlyTheNewestAnswerPaints() async {
        let recorder = Recorder()
        let committer = ChipEditCommitter(
            save: { _, _, values in await recorder.save(values) },
            resync: { _ in throw APIError.offline },
            persist: { _, book in recorder.persisted.append(book.subjects) }
        )

        async let first = committer.commit(uuid: "u", kind: .tags, values: ["A"])
        await settle { recorder.filed.count == 1 }
        async let second = committer.commit(uuid: "u", kind: .tags, values: ["A", "B"])
        // The second request waits on the first rather than racing it.
        try? await Task.sleep(for: .milliseconds(20))
        #expect(recorder.filed == [["A"]])

        recorder.releaseFirst()
        let outcomes = await (first, second)

        #expect(recorder.filed == [["A"], ["A", "B"]])
        #expect(outcomes.0 == .superseded)
        #expect(outcomes.1 == .saved(book(tags: ["A", "B"])))
        // The superseded success still reached the replica.
        #expect(recorder.persisted == [["A"], ["A", "B"]])
    }

    @Test func listsOfDifferentKindsDoNotWaitOnEachOther() async {
        let recorder = Recorder()
        let committer = ChipEditCommitter(
            save: { _, _, values in await recorder.save(values) },
            resync: { _ in throw APIError.offline },
            persist: { _, _ in }
        )

        async let held = committer.commit(uuid: "u", kind: .tags, values: ["A"])
        await settle { recorder.filed.count == 1 }
        let genres = await committer.commit(uuid: "u", kind: .genres, values: ["Fantasy"])
        #expect(genres == .saved(book(tags: ["Fantasy"])))

        recorder.releaseFirst()
        #expect(await held == .saved(book(tags: ["A"])))
    }

    @Test func aRefusedSaveAdoptsTheServersListWhenItCanBeAsked() async {
        let committer = ChipEditCommitter(
            save: { _, _, _ in throw APIError.offline },
            resync: { _ in self.book(tags: ["server"]) },
            persist: { _, _ in }
        )
        let outcome = await committer.commit(uuid: "u", kind: .tags, values: ["A"])
        guard case .resynced(let current, let message) = outcome else {
            Issue.record("expected a resync, got \(outcome)")
            return
        }
        #expect(current.subjects == ["server"])
        #expect(!message.isEmpty)
    }

    @Test func aRefusedSaveRevertsWhenTheServerCannotBeAskedEither() async {
        let committer = ChipEditCommitter(
            save: { _, _, _ in throw APIError.offline },
            resync: { _ in throw APIError.offline },
            persist: { _, _ in }
        )
        let outcome = await committer.commit(uuid: "u", kind: .tags, values: ["A"])
        guard case .reverted(let message) = outcome else {
            Issue.record("expected a revert, got \(outcome)")
            return
        }
        #expect(!message.isEmpty)
    }
}
