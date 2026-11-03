//  CacheLiveTests.swift
//  What `Cache.live`'s `confirmsAnswer` adds, and what it leaves alone without it.
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
}
