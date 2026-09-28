//  HouseholdStatsTests.swift
//  The `GET /api/users` decode, the stats and recent-progress request
//  queries, and that another reader's stats and in-progress list bypass the
//  replica entirely.

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

private func resumePoint(uuid: String) -> ResumePoint {
    ResumePoint(
        record: ProgressRecord(
            bookUUID: uuid, format: .epub, epubCFI: "epubcfi(/6/4)", audioPositionSeconds: nil,
            updatedAt: 1_700_000_000, clientUpdatedAt: 1_700_000_000
        ),
        book: Book(id: 1, filename: "\(uuid).epub", title: "Title", uniqueIdentifier: uuid, formats: ["epub"]),
        audioPart: nil, audioPartCount: nil
    )
}

/// Open the real replica, seed `key` with `seed`, hand the test the exact
/// bytes that landed, and restore whatever was there before — or delete the
/// key — once `body` returns or throws. Shared by every routing suite below,
/// each of which seeds its own key.
private func withSeededReplica<T: Codable & Sendable>(
    key: String, seed: T, _ body: (_ seedBytes: Data?) async throws -> Void
) async throws {
    await OfflineStore.shared.open()
    let saved = await OfflineStore.shared.cacheGet(key)
    await Cache.write(key, seed)
    let seedBytes = await OfflineStore.shared.cacheGet(key)
    do {
        try await body(seedBytes)
    } catch {
        await restore(saved, at: key)
        throw error
    }
    await restore(saved, at: key)
}

private func restore(_ saved: Data?, at key: String) async {
    if let saved {
        await OfflineStore.shared.cachePut(key, saved)
    } else {
        await OfflineStore.shared.cacheDelete(key)
    }
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

struct RecentProgressRequestTests {
    @Test func recentProgressQueryHasOnlyLimitForYourOwnRequest() {
        let q = UserDataService.recentProgressQuery(userID: nil)
        #expect(Set(q.keys) == ["limit"])
        #expect(q["limit"] == .some("5"))
    }

    @Test func recentProgressQueryAddsUserIDForAnotherReader() {
        let q = UserDataService.recentProgressQuery(userID: 7)
        #expect(Set(q.keys) == ["limit", "user_id"])
        #expect(q["user_id"] == .some("7"))
        #expect(q["limit"] == .some("5"))
    }
}

/// `.serialized`: every test shares one on-disk replica key
/// (`CacheKey.stats(.year)`), so a concurrent pair would race the same file.
@Suite(.serialized)
struct StatsReplicaRoutingTests {
    private let key = CacheKey.stats(.year)

    @Test func anotherReadersStatsYieldOnlyTheFreshAnswerAndNeverTouchTheReplica() async throws {
        try await withSeededReplica(key: key, seed: summary(booksFinished: 1)) { seedBytes in
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
        try await withSeededReplica(key: key, seed: summary(booksFinished: 1)) { seedBytes in
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
        try await withSeededReplica(key: key, seed: summary(booksFinished: 1)) { _ in
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

/// `.serialized`: every test shares one on-disk replica key
/// (`CacheKey.recentProgress`), which the Continue rail and the widget also
/// read, so a concurrent pair would race the same file.
@Suite(.serialized)
struct RecentProgressReplicaRoutingTests {
    private let key = CacheKey.recentProgress
    private let seed = [resumePoint(uuid: "seed-a")]

    @Test func anotherReadersInProgressListYieldsOnlyTheFreshAnswerAndNeverTouchesTheReplica() async throws {
        try await withSeededReplica(key: key, seed: seed) { seedBytes in
            var values: [CacheRead<[ResumePoint]>] = []
            let reads = UserDataService.recentProgressReads(subject: .reader(reader(1, "Ada"))) {
                [resumePoint(uuid: "fresh-b")]
            }
            for try await read in reads {
                values.append(read)
            }
            #expect(values.count == 1)
            #expect(values.first?.value.map(\.record.bookUUID) == ["fresh-b"])
            #expect(values.first?.isFresh == true)
            let stored = await OfflineStore.shared.cacheGet(self.key)
            #expect(stored == seedBytes)
        }
    }

    @Test func anotherReadersFailingFetchThrowsAndNeverTouchesTheReplica() async throws {
        try await withSeededReplica(key: key, seed: seed) { seedBytes in
            var values: [CacheRead<[ResumePoint]>] = []
            var caught: APIError?
            do {
                let reads = UserDataService.recentProgressReads(subject: .reader(reader(1, "Ada"))) {
                    throw APIError.http(status: 404, message: "this reader isn't sharing their stats")
                }
                for try await read in reads {
                    values.append(read)
                }
            } catch let error as APIError {
                caught = error
            }
            #expect(values.isEmpty)
            guard case let .http(status, message) = caught else {
                Issue.record("expected APIError.http, got \(String(describing: caught))")
                return
            }
            #expect(status == 404)
            #expect(message == "this reader isn't sharing their stats")
            let stored = await OfflineStore.shared.cacheGet(self.key)
            #expect(stored == seedBytes)
        }
    }

    @Test func yourOwnInProgressListStillRevalidatesThroughTheReplica() async throws {
        try await withSeededReplica(key: key, seed: seed) { _ in
            var values: [CacheRead<[ResumePoint]>] = []
            let reads = UserDataService.recentProgressReads(subject: .you) {
                [resumePoint(uuid: "fresh-b")]
            }
            for try await read in reads {
                values.append(read)
            }
            #expect(values.map { $0.value.map(\.record.bookUUID) } == [["seed-a"], ["fresh-b"]])
            #expect(values.map(\.isFresh) == [false, true])
            let stored: [ResumePoint]? = await Cache.read(self.key)
            #expect(stored?.map(\.record.bookUUID) == ["fresh-b"])
        }
    }
}
