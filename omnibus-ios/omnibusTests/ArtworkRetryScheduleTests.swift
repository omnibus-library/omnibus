//  ArtworkRetryScheduleTests.swift
//  How often a failing Now Playing cover is fetched, and what brings a fetch forward.

import Testing

@testable import omnibus

struct ArtworkRetryScheduleTests {
    private let start = ContinuousClock.now

    /// A schedule on book "a", playing, that has failed `failures` times at `start`.
    private func failed(_ failures: Int) -> ArtworkRetrySchedule {
        var schedule = ArtworkRetrySchedule()
        schedule.noteCurrent(uuid: "a", isPlaying: true)
        for _ in 0..<failures { schedule.noteFailure(at: start) }
        return schedule
    }

    @Test func delayDoublesFromTheFirstUpToTheCap() {
        let delays = (1...7).map(ArtworkRetrySchedule.delay(afterFailures:))
        #expect(delays == [15, 30, 60, 120, 240, 240, 240].map { .seconds($0) })
        #expect(ArtworkRetrySchedule.delay(afterFailures: 1_000) == ArtworkRetrySchedule.longestDelay)
    }

    @Test func aFetchIsDueOnlyOnceItsWaitIsOver() {
        #expect(ArtworkRetrySchedule().fetchIsDue(at: start))
        let schedule = failed(1)
        #expect(!schedule.fetchIsDue(at: start + .seconds(14)))
        #expect(schedule.fetchIsDue(at: start + .seconds(15)))
    }

    /// Every 250 ms is how often 2x playback ticks.
    @Test func aFailingCoverIsFetchedOnTheScheduleWhateverTheTicks() {
        var schedule = ArtworkRetrySchedule()
        var fetchedAt: [Int] = []
        for tick in 0..<(600 * 4) {
            let now = start + .milliseconds(tick * 250)
            schedule.noteCurrent(uuid: "a", isPlaying: true)
            if schedule.fetchIsDue(at: now) {
                fetchedAt.append(tick / 4)
                schedule.noteFailure(at: now)
            }
        }
        #expect(fetchedAt == [0, 15, 45, 105, 225, 465])
    }

    @Test func anotherBookStartsCleanAndComingBackStartsCleanAgain() {
        var schedule = failed(3)
        schedule.noteCurrent(uuid: "b", isPlaying: true)
        #expect(schedule.fetchIsDue(at: start))
        schedule.noteFailure(at: start)

        schedule.noteCurrent(uuid: "a", isPlaying: true)
        #expect(schedule.fetchIsDue(at: start))
        schedule.noteFailure(at: start)
        #expect(!schedule.fetchIsDue(at: start + .seconds(14)))
        #expect(schedule.fetchIsDue(at: start + .seconds(15)))
    }

    @Test func aResumeLiftsTheWaitWithoutForgettingTheFailures() {
        var schedule = failed(2)

        // Neither a tick nor a pause is a resume.
        schedule.noteCurrent(uuid: "a", isPlaying: true)
        schedule.noteCurrent(uuid: "a", isPlaying: false)
        #expect(!schedule.fetchIsDue(at: start + .seconds(1)))

        schedule.noteCurrent(uuid: "a", isPlaying: true)
        #expect(schedule.fetchIsDue(at: start + .seconds(1)))

        schedule.noteFailure(at: start)
        #expect(!schedule.fetchIsDue(at: start + .seconds(59)))
        #expect(schedule.fetchIsDue(at: start + .seconds(60)))
    }

    @Test func aReturningConnectionLiftsOnlyAFirstFailuresWait() {
        var schedule = failed(1)
        schedule.noteConnectionReturned()
        #expect(schedule.fetchIsDue(at: start))

        schedule.noteFailure(at: start)
        schedule.noteConnectionReturned()
        #expect(!schedule.fetchIsDue(at: start + .seconds(29)))
    }

    /// A route that alone drops its connections: each fetch flips the app
    /// offline, and the probe brings it back ten seconds later.
    @Test func aCoverThatDropsTheConnectionIsFetchedLessAndLessOften() {
        var schedule = failed(0)
        var fetchedAt: [Int] = []
        var offlineUntil: Int?
        for second in 0..<600 {
            let now = start + .seconds(second)
            if let until = offlineUntil {
                guard second >= until else { continue }
                offlineUntil = nil
                schedule.noteConnectionReturned()
            }
            if schedule.fetchIsDue(at: now) {
                fetchedAt.append(second)
                schedule.noteFailure(at: now)
                offlineUntil = second + 10
            }
        }
        #expect(fetchedAt == [0, 10, 40, 100, 220, 460])
    }
}
