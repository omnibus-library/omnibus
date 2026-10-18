//  FirstFillCascadeTests.swift
//  The cover grids' entrance timing: cells in the opening window ripple in the
//  order they appear, and every cell after it arrives without a stagger.

import Foundation
import Testing

@testable import omnibus

@MainActor
struct FirstFillCascadeTests {
    @Test func cellsInTheOpeningWindowRippleInTheOrderTheyAppear() {
        let cascade = FirstFillCascade()
        let start = ContinuousClock.now

        let delays = (0..<4).map { cascade.delay(at: start + .milliseconds($0 * 10)) }

        #expect(delays == (0..<4).map { FirstFillCascade.stagger(slot: $0) })
        #expect(delays[0] == 0 && delays[3] > delays[2])
    }

    @Test func aCellAfterTheWindowArrivesWithoutADelayOnceTheFillHasStarted() {
        let cascade = FirstFillCascade()
        let start = ContinuousClock.now

        _ = cascade.delay(at: start)
        _ = cascade.delay(at: start)

        #expect(cascade.delay(at: start + FirstFillCascade.window) == 0)
        #expect(cascade.delay(at: start + .seconds(5)) == 0)
    }

    @Test func noCellStartsBeforeOneThatAppearedEarlier() {
        let cascade = FirstFillCascade()
        let start = ContinuousClock.now
        // A twelve-cell first fill, then two rows scrolled in: one while the
        // fill is still rippling, one after it has finished.
        let appearances = Array(repeating: 0, count: 12) + [160, 160, 160, 600, 600, 600]

        let starts = appearances.map { ms in
            Double(ms) / 1000 + cascade.delay(at: start + .milliseconds(ms))
        }

        // A mid-fill row starts with the fill's last cell, so allow rounding.
        #expect(zip(starts, starts.dropFirst()).allSatisfy { $1 >= $0 - 1e-9 })
        #expect(starts[12] > 0.16, "the row scrolled in mid-fill waits for it")
        #expect(starts[15] == 0.6, "the row scrolled in afterwards does not")
    }

    @Test func theWindowOpensOnTheFirstAppearanceNotOnCreation() {
        let cascade = FirstFillCascade()
        let first = ContinuousClock.now + .seconds(10)

        #expect(cascade.delay(at: first) == 0)
        #expect(cascade.delay(at: first + .milliseconds(50)) == FirstFillCascade.stagger(slot: 1))
    }

    @Test func staggerClimbsTowardTheCapWithoutEverReachingIt() {
        let delays = (0..<60).map { FirstFillCascade.stagger(slot: $0) }

        #expect(delays[0] == 0)
        #expect(abs(delays[1] - 0.04) < 1e-9)
        #expect(zip(delays, delays.dropFirst()).allSatisfy { $0 < $1 })
        #expect(delays.allSatisfy { $0 < 0.32 })
    }
}
