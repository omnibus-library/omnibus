//  ShelfMemberRead.swift
//  A shelf page's member read under the library filter: the books it holds,
//  the filter it answers, and whether it has answered. Kept apart from
//  `ShelfDetailView` so every transition is testable.

import Foundation

/// What a shelf page's member area shows.
enum ShelfMembersPhase: Equatable {
    case members
    case loading
    case filtered(FilteredPhase)
    case unreachable(count: Int64)
    case empty
}

/// The member read `ShelfDetailView` draws from.
struct ShelfMemberRead {
    private(set) var books: [Book] = []
    /// The clauses `books` was read under, so a filter change never shows
    /// another filter's members while its own answer is on the way.
    private(set) var clauses: [FilterClause] = []
    /// Whether the read has finished, as opposed to not having answered yet.
    private(set) var settled = false
    /// Why the read failed, for a filtered shelf with nothing to show.
    private(set) var error: String?
    private var current = UUID()

    /// Starts a read under `clauses`; answers carrying an older ticket are dropped.
    /// A refresh under the same filter keeps what is on screen, but a new filter,
    /// or a retry after a failure, has no answer yet.
    mutating func begin(_ clauses: [FilterClause]) -> UUID {
        if clauses != self.clauses {
            books = []
            self.clauses = clauses
            settled = false
        }
        if error != nil {
            error = nil
            settled = false
        }
        current = UUID()
        return current
    }

    mutating func receive(_ books: [Book], ticket: UUID) {
        guard ticket == current else { return }
        self.books = books
    }

    mutating func fail(_ message: String, ticket: UUID) {
        guard ticket == current else { return }
        error = message
    }

    /// The read finished. Offline with nothing cached it finishes without ever
    /// answering, which is exactly the case the unreachable state describes.
    mutating func settle(ticket: UUID) {
        guard ticket == current else { return }
        settled = true
    }

    /// Drops a book the reader just took off the shelf, filtered copy or not.
    mutating func remove(_ uuid: String) {
        books.removeAll { $0.uuid == uuid }
    }

    mutating func removeAll() {
        books = []
    }

    /// `knownCount` is the shelf index's count: offline with the page
    /// uncached there are books the device can't show, which is not the same
    /// as the shelf being empty.
    func phase(knownCount: Int64?) -> ShelfMembersPhase {
        if !books.isEmpty { return .members }
        if !clauses.isEmpty {
            guard settled else { return .filtered(.loading) }
            if let error { return .filtered(.failed(error)) }
            return .filtered(.noMatches)
        }
        guard settled else { return .loading }
        if let knownCount, knownCount > 0 { return .unreachable(count: knownCount) }
        return .empty
    }
}
