//  FirstFillCascadeTests.swift
//  The cover grids' entrance timing: cells in the opening window ripple in the
//  order they appear, and every cell after it arrives without a delay.

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

    @Test func aCellAfterTheWindowArrivesWithoutADelay() {
        let cascade = FirstFillCascade()
        let start = ContinuousClock.now

        _ = cascade.delay(at: start)
        _ = cascade.delay(at: start)

        #expect(cascade.delay(at: start + FirstFillCascade.window) == 0)
        #expect(cascade.delay(at: start + .seconds(5)) == 0)
    }

    @Test func theWindowOpensOnTheFirstAppearanceNotOnCreation() {
        let cascade = FirstFillCascade()
        let first = ContinuousClock.now + .seconds(10)

        #expect(cascade.delay(at: first) == 0)
        #expect(cascade.delay(at: first + .milliseconds(50)) == FirstFillCascade.stagger(slot: 1))
    }

    @Test func staggerIsCappedSoALargeFirstFillNeverWaitsLong() {
        #expect(FirstFillCascade.stagger(slot: 0) == 0)
        #expect(FirstFillCascade.stagger(slot: 3) == 3 * 0.04)
        #expect(FirstFillCascade.stagger(slot: 40) == 0.32)
    }
}
