//  HouseholdStatsTests.swift
//  The `GET /api/users` decode, the stats request query, and that another
//  reader's stats bypass the replica entirely (AC4).

import Foundation
import Testing

@testable import omnibus

private func reader(_ id: Int64, _ name: String, hasAvatar: Bool = false, isYou: Bool = false) -> HouseholdReader {
    HouseholdReader(id: id, name: name, hasAvatar: hasAvatar, isYou: isYou)
}

private func summary(booksFinished: Int64) -> StatsSummary {
    var s = StatsSummary()
    s.range = .year
    s.booksFinished = booksFinished
    return s
}

struct HouseholdReaderCodecTests {
    @Test func householdReadersDecodeInServerOrderWithTheirFields() throws {
        let json = """
            [{"id":1,"name":"Ada","has_avatar":true,"is_you":true},
             {"id":2,"name":"Ben","has_avatar":false,"is_you":false}]
            """
        let readers = try JSONDecoder().decode([HouseholdReader].self, from: Data(json.utf8))
        #expect(readers == [reader(1, "Ada", hasAvatar: true, isYou: true), reader(2, "Ben")])
    }

    @Test func householdReaderDecodesMissingAvatarAndYouFlagsAsFalse() throws {
        let json = #"{"id":3,"name":"Cass"}"#
        let one = try JSONDecoder().decode(HouseholdReader.self, from: Data(json.utf8))
        #expect(one == reader(3, "Cass"))
    }
}

struct StatsRequestTests {
    @Test func statsQueryOmitsUserIDWhenSubjectIsYou() {
        let q = UserDataService.statsQuery(range: .week, userID: nil)
        #expect(q["range"] == .some("week"))
        #expect(q["utc_offset_minutes"] == .some(String(SessionReport.localOffsetMinutes())))
        #expect(!q.keys.contains("user_id"))
    }

    @Test func statsQueryAddsUserIDWhenGiven() {
        let q = UserDataService.statsQuery(range: .week, userID: 7)
        #expect(q["user_id"] == .some("7"))
        #expect(q["utc_offset_minutes"] == .some(String(SessionReport.localOffsetMinutes())))
    }

    @Test func statsSubjectCacheKeyAndUserIDDifferByWhoseStats() {
        #expect(StatsSubject.you.cacheKey(.week) == CacheKey.stats(.week))
        #expect(StatsSubject.reader(reader(1, "Ada")).cacheKey(.week) == nil)
        #expect(StatsSubject.you.userID == nil)
        #expect(StatsSubject.reader(reader(1, "Ada")).userID == 1)
    }
}

/// `.serialized`: every test shares one on-disk replica key
/// (`CacheKey.stats(.year)`), the same precedent as
/// `SeriesStackCacheTests` in `SeriesStacksTests.swift`.
@Suite(.serialized)
struct StatsReplicaRoutingTests {
    private let key = CacheKey.stats(.year)

    /// Open the real replica, seed `key` with `seed`, hand the test the exact
    /// bytes that landed, and restore whatever was there before — or delete
    /// the key — once `body` returns or throws.
    private func withSeededReplica(
        seed: StatsSummary, _ body: (_ seedBytes: Data?) async throws -> Void
    ) async throws {
        await OfflineStore.shared.open()
        let saved = await OfflineStore.shared.cacheGet(key)
        await Cache.write(key, seed)
        let seedBytes = await OfflineStore.shared.cacheGet(key)
        do {
            try await body(seedBytes)
        } catch {
            await restore(saved)
            throw error
        }
        await restore(saved)
    }

    private func restore(_ saved: Data?) async {
        if let saved {
            await OfflineStore.shared.cachePut(key, saved)
        } else {
            await OfflineStore.shared.cacheDelete(key)
        }
    }

    @Test func anotherReadersStatsYieldOnlyTheFreshAnswerAndNeverTouchTheReplica() async throws {
        try await withSeededReplica(seed: summary(booksFinished: 1)) { seedBytes in
            var values: [CacheRead<StatsSummary>] = []
            let reads = UserDataService.statsReads(range: .year, subject: .reader(reader(1, "Ada"))) {
                summary(booksFinished: 2)
            }
            for try await read in reads {
                values.append(read)
            }
            #expect(values.count == 1)
            #expect(values.first?.value.booksFinished == 2)
            #expect(values.first?.isFresh == true)
            let stored = await OfflineStore.shared.cacheGet(self.key)
            #expect(stored == seedBytes)
        }
    }

    @Test func anotherReadersFailingFetchThrowsAndNeverTouchesTheReplica() async throws {
        try await withSeededReplica(seed: summary(booksFinished: 1)) { seedBytes in
            var values: [CacheRead<StatsSummary>] = []
            var caught: APIError?
            do {
                let reads = UserDataService.statsReads(
                    range: .year, subject: .reader(reader(1, "Ada"))
                ) { throw APIError.offline }
                for try await read in reads {
                    values.append(read)
                }
            } catch let error as APIError {
                caught = error
            }
            #expect(values.isEmpty)
            guard case .offline = caught else {
                Issue.record("expected APIError.offline, got \(String(describing: caught))")
                return
            }
            let stored = await OfflineStore.shared.cacheGet(self.key)
            #expect(stored == seedBytes)
        }
    }

    @Test func yourOwnStatsStillRevalidateThroughTheReplica() async throws {
        try await withSeededReplica(seed: summary(booksFinished: 1)) { _ in
            var values: [CacheRead<StatsSummary>] = []
            let reads = UserDataService.statsReads(range: .year, subject: .you) {
                summary(booksFinished: 2)
            }
            for try await read in reads {
                values.append(read)
            }
            #expect(values.map(\.value.booksFinished) == [1, 2])
            #expect(values.map(\.isFresh) == [false, true])
            let stored: StatsSummary? = await Cache.read(self.key)
            #expect(stored?.booksFinished == 2)
        }
    }
}
