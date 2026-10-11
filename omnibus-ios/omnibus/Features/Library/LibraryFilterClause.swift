//  LibraryFilterClause.swift
//  The library filter: a list of clauses whose values OR together and whose
//  clauses AND together, sent to `GET /api/ebooks` and the shelf page as one
//  `?filter=` JSON param, and kept between launches.
//
//  Port of `shared/src/view_filters.rs`; the JSON shape is the server's.

import Foundation
import Observation

/// The book attribute a clause matches. Raw values are the shared wire tokens;
/// declaration order is the picker's. A `shelf` value is a shelf id.
enum FilterField: String, CaseIterable, Codable, Hashable, Sendable {
    case shelf, tag, genre, author, series, format

    var label: String {
        switch self {
        case .shelf: "Shelf"
        case .tag: "Tag"
        case .genre: "Genre"
        case .author: "Author"
        case .series: "Series"
        case .format: "Format"
        }
    }

    /// Named so a test can prove it resolves — a misspelt SF Symbol draws nothing.
    var glyph: String {
        switch self {
        case .shelf: "square.stack"
        case .tag: "tag"
        case .genre: "theatermasks"
        case .author: "person"
        case .series: "books.vertical"
        case .format: "doc"
        }
    }
}

/// Whether a clause keeps the books that match it or drops them.
enum FilterMode: String, CaseIterable, Codable, Hashable, Sendable {
    case include, exclude

    /// The picker's name for the mode.
    var label: String {
        switch self {
        case .include: "Includes any"
        case .exclude: "Excludes any"
        }
    }

    /// The mode as a chip reads it, the web's wording.
    var phrase: String {
        switch self {
        case .include: "includes any of"
        case .exclude: "excludes any of"
        }
    }
}

/// One clause of the library filter.
struct FilterClause: Codable, Hashable, Sendable {
    var field: FilterField
    var mode: FilterMode
    var values: [String]

    /// The server's caps (`MAX_FILTER_CLAUSES`, `MAX_FILTER_VALUES`); past
    /// either it answers 400.
    static let maxClauses = 16
    static let maxValues = 64

    /// "Genre includes any of Fantasy, Sci-Fi". A shelf reads as its name:
    /// "…" while `shelves` is still loading (`nil`), and "unavailable shelf"
    /// for an id the list doesn't hold.
    func chipLabel(shelves: [ShelfSummary]?, viewerId: Int64?) -> String {
        let names = values.map { value -> String in
            switch field {
            case .format: return value.uppercased()
            case .shelf: return shelfName(value, in: shelves, viewerId: viewerId)
            default: return value
            }
        }
        return "\(field.label) \(mode.phrase) \(names.joined(separator: ", "))"
    }

    private func shelfName(_ value: String, in shelves: [ShelfSummary]?, viewerId: Int64?) -> String {
        guard let shelves else { return "…" }
        let id = Int64(value.trimmingCharacters(in: .whitespaces))
        guard let shelf = shelves.first(where: { $0.id == id }) else { return "unavailable shelf" }
        return FilterOption.shelfLabel(shelf, viewerId: viewerId)
    }

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
/// shelf clause, and the server didn't answer — or the read was the Offline
/// view, which only the mirror answers.
enum LibraryFilterError: LocalizedError {
    case needsConnection
    case shelfOnDevice

    static let connectionNotice =
        "Filters need a connection to the server. Clear them to browse what's on this device."

    var errorDescription: String? {
        switch self {
        case .needsConnection:
            Self.connectionNotice
        case .shelfOnDevice:
            "Shelf filters can't be combined with the Offline view: it only knows what's on this device. Clear them to browse your downloads."
        }
    }

    /// What a filtered read that failed with nothing to show should say: an
    /// unreachable server means the filter can't be answered here.
    static func message(for error: Error) -> String {
        if let api = error as? APIError, api.isRecoverableOffline { return connectionNotice }
        return error.localizedDescription
    }
}

/// The library filter's one in-memory copy, shared by the library and every
/// shelf page, and written through to `LibraryFilterPreference` on each change.
/// Cleared on a sign-out, an account switch and a server change.
@Observable
@MainActor
final class LibraryFilterStore {
    static let shared = LibraryFilterStore()

    private(set) var clauses: [FilterClause]
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        clauses = LibraryFilterPreference.load(from: defaults).clauses
    }

    var canAdd: Bool { clauses.count < FilterClause.maxClauses }

    /// Appends `clause`, unless it is one the server would refuse.
    func add(_ clause: FilterClause) {
        guard canAdd, !clause.values.isEmpty, clause.values.count <= FilterClause.maxValues
        else { return }
        replace(with: clauses + [clause])
    }

    func remove(at index: Int) {
        guard clauses.indices.contains(index) else { return }
        var next = clauses
        next.remove(at: index)
        replace(with: next)
    }

    func clear() {
        replace(with: [])
    }

    private func replace(with next: [FilterClause]) {
        clauses = next
        LibraryFilterPreference(clauses: next).save(to: defaults)
    }
}
