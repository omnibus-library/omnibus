//  CacheSettledTests.swift
//  A one-shot read bounded by a deadline: what a car waiting to play gets.
//
//  The car's play read the whole live answer, so a server mid-deploy (a 502)
//  turned a downloaded book into silence, and poor signal kept it waiting out
//  the outbox drain and the request timeout. These pin the bound: the server's
//  answer when it is prompt, else the replica, on any failure too.

import Foundation
import Testing

@testable import omnibus

/// Run `body` against a fresh key in the real replica, seeded with `seed`
/// when given, and delete the key afterwards.
private func withScratchKey(
    seed: [Int]?, _ body: (_ key: String) async throws -> Void
) async throws {
    await OfflineStore.shared.open()
    let key = "test-settled:\(UUID().uuidString)"
    if let seed { await Cache.write(key, seed) }
    do {
        try await body(key)
    } catch {
        await OfflineStore.shared.cacheDelete(key)
        throw error
    }
    await OfflineStore.shared.cacheDelete(key)
}

struct CacheSettledTests {
    private let deadline: Duration = .milliseconds(20)

    @Test func settledWithinPrefersAPromptServerAnswer() async throws {
        try await withScratchKey(seed: [1]) { key in
            let value: [Int]? = await Cache.settled(key, within: .seconds(5)) { [2] }
            #expect(value == [2])
        }
    }

    @Test func settledWithinFallsBackToTheReplicaWhenTheServerFails() async throws {
        // A 502 mid-deploy is not an offline failure, and still must not hide
        // what the device holds.
        try await withScratchKey(seed: [1]) { key in
            let value: [Int]? = await Cache.settled(key, within: .seconds(5)) {
                throw APIError.http(status: 502, message: "Bad Gateway")
            }
            #expect(value == [1])
        }
    }

    @Test func settledWithinAnswersFromTheReplicaAtTheDeadlineAndRefreshesItAfter() async throws {
        try await withScratchKey(seed: [1]) { key in
            let (gate, open) = AsyncStream<Void>.makeStream()
            let value: [Int]? = await Cache.settled(key, within: deadline) {
                for await _ in gate { break }
                return [2]
            }
            #expect(value == [1])
            // The read was left running, so the late answer still lands.
            open.yield()
            var stored: [Int]?
            for _ in 0..<200 {
                stored = await Cache.read(key)
                if stored == [2] { break }
                try await Task.sleep(for: .milliseconds(25))
            }
            #expect(stored == [2])
        }
    }

    @Test func settledWithinWaitsOutASlowAnswerWhenThereIsNoReplica() async throws {
        try await withScratchKey(seed: nil) { key in
            let value: [Int]? = await Cache.settled(key, within: deadline) {
                try await Task.sleep(for: .milliseconds(100))
                return [2]
            }
            #expect(value == [2])
        }
    }

    @Test func settledWithinIsNilWithNoReplicaAndAFailedRead() async throws {
        try await withScratchKey(seed: nil) { key in
            let value: [Int]? = await Cache.settled(key, within: deadline) {
                throw APIError.http(status: 502, message: "Bad Gateway")
            }
            #expect(value == nil)
        }
    }
}
