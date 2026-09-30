//  SearchFacet.swift
//  A taxonomy a book is filed under, asked for as an exact facet.
//
//  Free text matches titles, authors and series only, so a tag or genre name
//  searched as plain words finds the books whose *title* happens to contain
//  it — not the books filed under it. Opening a tag or genre asks the server
//  for the facet, spelled exactly as the web's `format::facet_query` spells it.

import Foundation

enum SearchFacet: String, Hashable, Sendable {
    case tag
    case genre

    /// The `/api/search` query for the books filed under `name`: quoted
    /// whenever it isn't one bare word, with `""` escaping an embedded quote.
    func query(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        let words = trimmed.split(whereSeparator: \.isWhitespace)
        if words.count > 1 || trimmed.contains("\"") {
            return "\(rawValue):\"\(trimmed.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return "\(rawValue):\(trimmed)"
    }

    /// The `Book` field the local mirror holds this taxonomy under.
    var payloadKey: String {
        switch self {
        case .tag: "subjects"
        case .genre: "genres"
        }
    }
}
