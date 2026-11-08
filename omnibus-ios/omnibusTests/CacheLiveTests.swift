//  CacheLiveTests.swift
//  What `Cache.live`'s `confirmsAnswer` adds, and what it leaves alone without
//  it; and when its `adopted` runs.
//
//  Off, an answer identical to the replica isn't repeated, so a last answer not
//  fresh can mean the server agreed or that it failed. On, it can only mean the
//  second, which is how the car tells a server's answer from a replica's.

import Foundation
import Testing

@testable import omnibus

/// The freshness of each answer a read over a replica holding `[1]` gives.
private func freshness(
    confirmsAnswer: Bool,
    fetch: @escaping @Sendable () async throws -> [Int]
) async throws -> [Bool] {
    await OfflineStore.shared.open()
    let key = "test-live:\(UUID().uuidString)"
    await Cache.write(key, [1])
    var seen: [Bool] = []
    for try await read in Cache.live(key, confirmsAnswer: confirmsAnswer, fetch: fetch) {
        seen.append(read.isFresh)
    }
    await OfflineStore.shared.cacheDelete(key)
    return seen
}

struct CacheLiveTests {
    @Test func liveDoesNotRepeatAnIdenticalAnswerByDefault() async throws {
        #expect(try await freshness(confirmsAnswer: false) { [1] } == [false])
    }

    @Test func liveYieldsAnIdenticalAnswerAsFreshWhenAskedToConfirmIt() async throws {
        #expect(try await freshness(confirmsAnswer: true) { [1] } == [false, true])
    }

    @Test func liveYieldsADifferentAnswerAsFreshEitherWay() async throws {
        #expect(try await freshness(confirmsAnswer: false) { [2] } == [false, true])
        #expect(try await freshness(confirmsAnswer: true) { [2] } == [false, true])
    }

    @Test func liveEndsNotFreshWhenTheServerFailsThoughAskedToConfirm() async throws {
        #expect(try await freshness(confirmsAnswer: true) { throw APIError.offline } == [false])
    }

    @Test func liveRunsAdoptedOnceTheAnswerIsStoredThoughTheReaderLeftAfterTheReplica() async throws {
        await OfflineStore.shared.open()
        let key = "test-live:\(UUID().uuidString)"
        await Cache.write(key, [1])
        let (adopted, adoption) = AsyncStream<[Int]?>.makeStream()
        // The answer is held until the reader has gone.
        let (gate, opener) = AsyncStream<Void>.makeStream()
        let reads = Cache.live(key, adopted: { _ in adoption.yield(await Cache.read(key)) }) {
            for await _ in gate {}
            return [2]
        }
        for try await read in reads {
            #expect(!read.isFresh)
            break
        }
        opener.finish()
        let waited = Task { () -> [Int]?? in
            for await stored in adopted { return stored }
            return nil
        }
        let stored = await firstResult(of: waited, within: .seconds(5))
        // Run once the replica held the answer, not merely once it arrived.
        #expect(stored == .some(.some([2])))
        await OfflineStore.shared.cacheDelete(key)
    }

    @Test func liveAdoptsNothingWhenOnlyTheReplicaAnswers() async throws {
        await OfflineStore.shared.open()
        let key = "test-live:\(UUID().uuidString)"
        await Cache.write(key, [1])
        let (adopted, adoption) = AsyncStream<[Int]>.makeStream()
        let reads = Cache.live(key, adopted: { adoption.yield($0) }) { () async throws -> [Int] in
            throw APIError.offline
        }
        for try await _ in reads {}
        adoption.finish()
        var seen: [[Int]] = []
        for await value in adopted { seen.append(value) }
        #expect(seen.isEmpty)
        await OfflineStore.shared.cacheDelete(key)
    }
}
