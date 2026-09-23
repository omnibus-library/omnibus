//  DictionaryOrder.swift
//  The library's sort order, mirrored from `shared/src/sort_order.rs` so the
//  offline mirror files a book where the server's Author, Title and Series
//  axes do — surname-first, accents ignored — rather than in its own order.

import Foundation
import SQLite3

enum DictionaryOrder {
    /// The collation name the mirror's text sorts use. Registered on every
    /// connection that runs them; never named in a table definition, so the
    /// file stays readable to tools that lack it.
    static let collation = "dictionary"

    /// Dictionary order: accents and case ignored, a comma filing below a
    /// space (so a surname ends at its comma), and the plain spelling first
    /// when two strings are otherwise identical. Mirrors `dictionary_cmp`.
    static func compare(_ lhs: String, _ rhs: String) -> Int32 {
        let folded = order(fold(lhs), fold(rhs))
        return folded != 0 ? folded : order(Array(lhs.utf8), Array(rhs.utf8))
    }

    /// Install `compare` as the `dictionary` collation on `db`.
    @discardableResult
    static func register(on db: OpaquePointer?) -> Bool {
        sqlite3_create_collation_v2(
            db, collation, SQLITE_UTF8, nil,
            { _, lhsCount, lhs, rhsCount, rhs in
                DictionaryOrder.compare(
                    DictionaryOrder.text(lhs, lhsCount),
                    DictionaryOrder.text(rhs, rhsCount)
                )
            },
            nil
        ) == SQLITE_OK
    }

    /// Surname-first key for an author display name: a comma form or a
    /// mononym verbatim, otherwise the last word becomes the surname
    /// (`Andy Weir` → `Weir, Andy`). Mirrors `author_sort_key`.
    static func authorSortKey(_ name: String) -> String {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let scalars = name.unicodeScalars
        guard !name.contains(","), let space = scalars.lastIndex(of: " ") else { return name }
        return "\(String(scalars[scalars.index(after: space)...])), \(String(scalars[..<space]))"
    }

    /// The key a book files under: `fileAs` only in comma form, else derived
    /// from the display name — from `fileAs` only when there is no name.
    /// Mirrors `creator_sort_key`.
    static func creatorSortKey(fileAs: String?, name: String) -> String {
        let fileAs = fileAs?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if fileAs.contains(",") { return fileAs }
        let blankName = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return authorSortKey(!fileAs.isEmpty && blankName ? fileAs : name)
    }

    /// The scalars `compare` orders by: compatibility-decomposed, combining
    /// marks dropped, lowercased, with a comma lowered below every printable
    /// character.
    private static func fold(_ string: String) -> [UInt32] {
        var out: [UInt32] = []
        for scalar in string.decomposedStringWithCompatibilityMapping.unicodeScalars
        where !isMark(scalar) {
            for lower in scalar.properties.lowercaseMapping.unicodeScalars {
                out.append(lower == "," ? 0 : lower.value)
            }
        }
        return out
    }

    private static func isMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    private static func order<T: Comparable>(_ lhs: [T], _ rhs: [T]) -> Int32 {
        if lhs.lexicographicallyPrecedes(rhs) { return -1 }
        return rhs.lexicographicallyPrecedes(lhs) ? 1 : 0
    }

    private static func text(_ bytes: UnsafeRawPointer?, _ count: Int32) -> String {
        String(decoding: UnsafeRawBufferPointer(start: bytes, count: Int(count)), as: UTF8.self)
    }
}
