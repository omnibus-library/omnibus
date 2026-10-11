//  LibraryFilterClause.swift
//  The library filter: a list of clauses whose values OR together and whose
//  clauses AND together, sent to `GET /api/ebooks` and the shelf page as one
//  `?filter=` JSON param, and kept between launches.
//
//  Port of `shared/src/view_filters.rs`; the JSON shape is the server's.

import Foundation

/// The book attribute a clause matches. Raw values are the shared wire tokens;
/// declaration order is the picker's. A `shelf` value is a shelf id.
enum FilterField: String, CaseIterable, Codable, Hashable, Sendable {
    case shelf, tag, genre, author, series, format
}

/// Whether a clause keeps the books that match it or drops them.
enum FilterMode: String, CaseIterable, Codable, Hashable, Sendable {
    case include, exclude
}

/// One clause of the library filter.
struct FilterClause: Codable, Hashable, Sendable {
    var field: FilterField
    var mode: FilterMode
    var values: [String]

    /// The `?filter=` value: the clauses as the server's compact JSON array, or
    /// `nil` when there are none. Not percent-encoded.
    static func queryValue(_ clauses: [FilterClause]) -> String? {
        guard !clauses.isEmpty else { return nil }
        return json(clauses)
    }

    /// A cache-key fragment naming the clause set, the same whatever order the
    /// clauses or their values were picked in; empty when there are none.
    static func signature(_ clauses: [FilterClause]) -> String {
        guard !clauses.isEmpty else { return "" }
        let canonical = clauses
            .map { FilterClause(field: $0.field, mode: $0.mode, values: $0.values.sorted()) }
            .sorted { (json([$0]) ?? "") < (json([$1]) ?? "") }
        return json(canonical) ?? String(describing: canonical)
    }

    private static func json(_ clauses: [FilterClause]) -> String? {
        let encoder = JSONEncoder()
        // Sorted keys happen to be the server's own field order, and a slash
        // stays a slash, so the text is exactly what `serde_json` would write.
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(clauses)).map { String(decoding: $0, as: UTF8.self) }
    }
}

/// The library filter's clauses, kept in `UserDefaults` like the sort so they
/// survive a relaunch.
///
/// Stored one JSON string per clause, and decoded per clause, so a field token
/// a later build no longer knows costs the reader that one clause, not all.
struct LibraryFilterPreference: Equatable, Sendable {
    var clauses: [FilterClause] = []

    static let key = "omnibus.library.filterClauses"

    static func load(from defaults: UserDefaults = .standard) -> LibraryFilterPreference {
        let decoder = JSONDecoder()
        let stored = defaults.stringArray(forKey: key) ?? []
        return LibraryFilterPreference(
            clauses: stored.compactMap { try? decoder.decode(FilterClause.self, from: Data($0.utf8)) }
        )
    }

    func save(to defaults: UserDefaults = .standard) {
        let encoder = JSONEncoder()
        let stored = clauses.compactMap { clause in
            (try? encoder.encode(clause)).map { String(decoding: $0, as: UTF8.self) }
        }
        defaults.set(stored, forKey: Self.key)
    }
}

/// Why a filtered library read had no answer: the mirror can't evaluate a
/// shelf clause, and the server didn't answer.
enum LibraryFilterError: LocalizedError {
    case needsConnection

    static let connectionNotice =
        "Filters need a connection to the server. Clear them to browse what's on this device."

    var errorDescription: String? { Self.connectionNotice }
}
