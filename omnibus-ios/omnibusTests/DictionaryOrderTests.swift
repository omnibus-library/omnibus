//  DictionaryOrderTests.swift
//  The offline mirror's text sorts: the dictionary collation it registers,
//  the surname-first author key each row stores, and the order `LibraryIndex`
//  produces from both — which must match the server's Author axis.

import Foundation
import SQLite3
import Testing

@testable import omnibus

struct DictionaryOrderCompareTests {
    @Test func filesAccentedSurnamesInDictionaryOrder() {
        let expected = [
            "Perez, Ana",
            "Pérez Galdós, Benito",
            "Perry, Anne",
            "Pettichord, Bret",
            "Polk, Sarah",
        ]
        let sorted = expected.reversed().sorted { DictionaryOrder.compare($0, $1) < 0 }
        #expect(sorted == expected)
    }

    @Test func putsThePlainSpellingFirstOnATie() {
        #expect(DictionaryOrder.compare("Perez", "Pérez") < 0)
        #expect(DictionaryOrder.compare("Pérez", "Perez") > 0)
        #expect(DictionaryOrder.compare("Pérez", "Pérez") == 0)
    }

    @Test func ignoresCaseBeforeBreakingTheTieOnIt() {
        #expect(DictionaryOrder.compare("apple", "Banana") < 0)
        #expect(DictionaryOrder.compare("Apple", "apple") < 0)
    }
}

struct AuthorSortKeyTests {
    @Test func reshapesAGivenFirstNameSurnameFirst() {
        #expect(DictionaryOrder.authorSortKey("Andy Weir") == "Weir, Andy")
        #expect(DictionaryOrder.authorSortKey("Ursula K. Le Guin") == "Guin, Ursula K. Le")
    }

    @Test func keepsCommaAndMononymFormsVerbatim() {
        #expect(DictionaryOrder.authorSortKey("Weir, Andy") == "Weir, Andy")
        #expect(DictionaryOrder.authorSortKey("  Plato ") == "Plato")
    }

    @Test func trustsFileAsOnlyInCommaForm() {
        #expect(
            DictionaryOrder.creatorSortKey(fileAs: "Pérez Galdós, Benito", name: "Benito Pérez Galdós")
                == "Pérez Galdós, Benito"
        )
        #expect(DictionaryOrder.creatorSortKey(fileAs: "Andy Weir", name: "Andy Weir") == "Weir, Andy")
        #expect(
            DictionaryOrder.creatorSortKey(fileAs: "Underwood", name: "Erin A. Craig") == "Craig, Erin A."
        )
        #expect(DictionaryOrder.creatorSortKey(fileAs: nil, name: "Andy Weir") == "Weir, Andy")
        #expect(DictionaryOrder.creatorSortKey(fileAs: "Andy Weir", name: " ") == "Weir, Andy")
    }

    @Test func mirrorRowStoresTheFirstCreatorsKey() {
        var book = Book(id: 1, filename: "a.epub", title: "A", uniqueIdentifier: "u1")
        book.creators = [Contributor(name: "Andy Weir", fileAs: "Andy Weir")]
        #expect(LibraryIndex.row(for: book, payload: Data()).authorSort == "Weir, Andy")
    }
}

// MARK: - Ordering, run against a scratch SQLite table

/// Order `(uuid, author, authorSort, title)` rows through the exact fragment
/// `LibraryIndex.order` generates for the Author axis, with the collation the
/// store registers, returning the uuids in result order.
private func orderedByAuthor(
    _ rows: [(uuid: String, author: String, authorSort: String, title: String)]
) -> [String] {
    // Every SQLite step is guarded rather than `#expect`ed: a nil handle after
    // a failed step would take the whole test process down with it.
    var db: OpaquePointer?
    guard sqlite3_open(":memory:", &db) == SQLITE_OK, db != nil else {
        Issue.record("could not open an in-memory database")
        return []
    }
    defer { sqlite3_close(db) }
    guard DictionaryOrder.register(on: db) else {
        Issue.record("could not register the dictionary collation")
        return []
    }
    guard
        sqlite3_exec(
            db,
            """
            CREATE TABLE books (
                uuid TEXT NOT NULL,
                author TEXT NOT NULL DEFAULT '',
                author_sort TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT ''
            )
            """,
            nil, nil, nil
        ) == SQLITE_OK
    else {
        Issue.record("could not create the scratch books table")
        return []
    }

    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for row in rows {
        var insert: OpaquePointer?
        guard
            sqlite3_prepare_v2(
                db, "INSERT INTO books (uuid, author, author_sort, title) VALUES (?, ?, ?, ?)",
                -1, &insert, nil
            ) == SQLITE_OK
        else {
            Issue.record("could not prepare the insert for \(row.uuid)")
            return []
        }
        defer { sqlite3_finalize(insert) }
        sqlite3_bind_text(insert, 1, row.uuid, -1, transient)
        sqlite3_bind_text(insert, 2, row.author, -1, transient)
        sqlite3_bind_text(insert, 3, row.authorSort, -1, transient)
        sqlite3_bind_text(insert, 4, row.title, -1, transient)
        guard sqlite3_step(insert) == SQLITE_DONE else {
            Issue.record("could not insert \(row.uuid)")
            return []
        }
    }

    let clause = LibraryIndex.order(sort: .author, direction: .asc)
    var stmt: OpaquePointer?
    guard
        sqlite3_prepare_v2(db, "SELECT uuid FROM books ORDER BY \(clause)", -1, &stmt, nil)
            == SQLITE_OK
    else {
        Issue.record("could not prepare a select ordered by: \(clause)")
        return []
    }
    defer { sqlite3_finalize(stmt) }
    var out: [String] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        out.append(String(cString: sqlite3_column_text(stmt, 0)))
    }
    return out
}

struct MirrorAuthorOrderTests {
    @Test func filesEveryAuthorSurnameFirstInDictionaryOrder() {
        let rows: [(uuid: String, author: String, authorSort: String, title: String)] = [
            ("weir", "andy weir", "Weir, Andy", "project hail mary"),
            ("polk", "sarah polk", "Polk, Sarah", "a"),
            ("galdos", "benito pérez galdós", "Pérez Galdós, Benito", "b"),
            ("perry", "anne perry", "Perry, Anne", "c"),
            ("perez", "ana perez", "Perez, Ana", "d"),
        ]
        #expect(orderedByAuthor(rows) == ["perez", "galdos", "perry", "polk", "weir"])
    }

    @Test func aMirrorWrittenBeforeTheKeyExistedKeepsItsDisplayNameOrder() {
        let rows: [(uuid: String, author: String, authorSort: String, title: String)] = [
            ("zed", "zed adams", "", "a"),
            ("amy", "amy zola", "", "b"),
        ]
        #expect(orderedByAuthor(rows) == ["amy", "zed"])
    }
}
