//  ShelfMemberReadTests.swift
//  A shelf page's member read under the library filter: what the page says
//  before, during and after a read, and which late answers it refuses.

import Foundation
import Testing

@testable import omnibus

private let genre = FilterClause(field: .genre, mode: .include, values: ["Fantasy"])
private let book = Book(id: 1, filename: "a.epub", title: "A", uniqueIdentifier: "a")

struct ShelfMemberReadTests {
    @Test func anUnfilteredReadIsLoadingUntilItSettles() {
        var read = ShelfMemberRead()
        _ = read.begin([])
        #expect(read.phase(knownCount: 0) == .loading, "unanswered is not \"nothing on this shelf\"")
    }

    @Test func clearingTheFilterIsLoadingRatherThanTheShelfsEmptyState() {
        var read = ShelfMemberRead()
        let filtered = read.begin([genre])
        read.settle(ticket: filtered)
        _ = read.begin([])
        #expect(read.phase(knownCount: 3) == .loading)
    }

    @Test func aRetryAfterAFailureIsLoadingRatherThanNoMatches() {
        var read = ShelfMemberRead()
        let first = read.begin([genre])
        read.fail("Server error (500).", ticket: first)
        read.settle(ticket: first)
        #expect(read.phase(knownCount: 3) == .filtered(.failed("Server error (500).")))
        _ = read.begin([genre])
        #expect(read.phase(knownCount: 3) == .filtered(.loading))
    }

    @Test func aRefreshKeepsWhatAnUnreachableShelfAlreadySays() {
        var read = ShelfMemberRead()
        let first = read.begin([])
        read.settle(ticket: first)
        _ = read.begin([])
        #expect(read.phase(knownCount: 3) == .unreachable(count: 3))
    }

    @Test func aFilterChangeDropsTheMembersReadUnderTheOldOne() {
        var read = ShelfMemberRead()
        let first = read.begin([])
        read.receive([book], ticket: first)
        _ = read.begin([genre])
        #expect(read.books.isEmpty)
        #expect(read.phase(knownCount: 3) == .filtered(.loading))
    }

    @Test func anAnswerToASupersededReadIsDropped() {
        var read = ShelfMemberRead()
        let superseded = read.begin([genre])
        _ = read.begin([])
        read.receive([book], ticket: superseded)
        read.fail("late", ticket: superseded)
        read.settle(ticket: superseded)
        #expect(read.books.isEmpty)
        #expect(read.phase(knownCount: 0) == .loading)
    }

    @Test func aSettledFilteredReadWithNoBooksIsNoMatches() {
        var read = ShelfMemberRead()
        let ticket = read.begin([genre])
        read.settle(ticket: ticket)
        #expect(read.phase(knownCount: 3) == .filtered(.noMatches))
    }

    @Test func aSettledUnfilteredReadWithNoKnownBooksIsEmpty() {
        var read = ShelfMemberRead()
        let ticket = read.begin([])
        read.settle(ticket: ticket)
        #expect(read.phase(knownCount: 0) == .empty)
        #expect(read.phase(knownCount: nil) == .empty)
    }
}
