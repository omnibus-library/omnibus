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

    @Test func mirrorRowKeepsTheUnloweredTitleAndSeriesForSorting() {
        var book = Book(id: 1, filename: "a.epub", title: "Apple", uniqueIdentifier: "u1")
        book.series = "Dune"
        let row = LibraryIndex.row(for: book, payload: Data())
        #expect(row.title == "apple")
        #expect(row.titleSort == "Apple")
        #expect(row.series == "dune")
        #expect(row.seriesSort == "Dune")
    }
}

// MARK: - Ordering, run against a scratch SQLite table

/// One mirror row's sort-relevant columns; unset ones take the empty default
/// a mirror written before them carries.
private struct SortRow {
    var uuid: String
    var title = ""
    var titleSort = ""
    var author = ""
    var authorSort = ""
    var series = ""
    var seriesSort = ""
}

/// Order `rows` through the exact fragment `LibraryIndex.order` generates for
/// `sort`, on a connection opened the way the store opens its own, returning
/// the uuids in result order.
private func ordered(_ rows: [SortRow], by sort: SortKey, _ direction: SortDirection = .asc)
    -> [String]
{
    // Every SQLite step is guarded rather than `#expect`ed: a nil handle after
    // a failed step would take the whole test process down with it.
    guard let db = OfflineStore.connect(path: ":memory:") else {
        Issue.record("could not open an in-memory database with the collation")
        return []
    }
    defer { sqlite3_close(db) }
    guard
        sqlite3_exec(
            db,
            """
            CREATE TABLE books (
                uuid TEXT NOT NULL,
                title TEXT NOT NULL, title_sort TEXT NOT NULL,
                author TEXT NOT NULL, author_sort TEXT NOT NULL,
                series TEXT NOT NULL, series_sort TEXT NOT NULL,
                series_index REAL NOT NULL DEFAULT 0
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
                db,
                """
                INSERT INTO books (uuid, title, title_sort, author, author_sort, series, series_sort)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                -1, &insert, nil
            ) == SQLITE_OK
        else {
            Issue.record("could not prepare the insert for \(row.uuid)")
            return []
        }
        defer { sqlite3_finalize(insert) }
        let values = [
            row.uuid, row.title, row.titleSort, row.author, row.authorSort, row.series,
            row.seriesSort,
        ]
        for (index, value) in values.enumerated() {
            sqlite3_bind_text(insert, Int32(index + 1), value, -1, transient)
        }
        guard sqlite3_step(insert) == SQLITE_DONE else {
            Issue.record("could not insert \(row.uuid)")
            return []
        }
    }

    let clause = LibraryIndex.order(sort: sort, direction: direction)
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

struct MirrorOrderTests {
    @Test func filesEveryAuthorSurnameFirstInDictionaryOrder() {
        let rows = [
            SortRow(uuid: "weir", author: "andy weir", authorSort: "Weir, Andy"),
            SortRow(uuid: "polk", author: "sarah polk", authorSort: "Polk, Sarah"),
            SortRow(uuid: "galdos", author: "benito pérez galdós", authorSort: "Pérez Galdós, Benito"),
            SortRow(uuid: "perry", author: "anne perry", authorSort: "Perry, Anne"),
            SortRow(uuid: "perez", author: "ana perez", authorSort: "Perez, Ana"),
        ]
        #expect(ordered(rows, by: .author) == ["perez", "galdos", "perry", "polk", "weir"])
    }

    @Test func aMirrorWrittenBeforeTheSortColumnsKeepsItsSearchColumnOrder() {
        let rows = [
            SortRow(uuid: "zed", title: "b", author: "zed adams"),
            SortRow(uuid: "amy", title: "a", author: "amy zola"),
        ]
        #expect(ordered(rows, by: .author) == ["amy", "zed"])
        #expect(ordered(rows, by: .title) == ["amy", "zed"])
    }

    /// The server folds case, then breaks the tie on the original bytes, so
    /// `Apple` files before `apple` — which the lowercased column alone could
    /// not tell apart.
    @Test func breaksACaseOnlyTieTheWayTheServerDoes() {
        let rows = [
            SortRow(uuid: "lower", title: "apple", titleSort: "apple", series: "dune", seriesSort: "dune"),
            SortRow(uuid: "upper", title: "apple", titleSort: "Apple", series: "dune", seriesSort: "Dune"),
        ]
        #expect(DictionaryOrder.compare("Apple", "apple") < 0)
        #expect(ordered(rows, by: .title) == ["upper", "lower"])
        #expect(ordered(rows, by: .title, .desc) == ["lower", "upper"])
        #expect(ordered(rows, by: .series) == ["upper", "lower"])
    }
}

// MARK: - Connection

struct OfflineStoreConnectTests {
    @Test func connectsWithTheDictionaryCollationRegistered() {
        guard let db = OfflineStore.connect(path: ":memory:") else {
            Issue.record("could not open an in-memory database")
            return
        }
        defer { sqlite3_close(db) }
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        #expect(
            sqlite3_prepare_v2(db, "SELECT 'a' ORDER BY 1 COLLATE dictionary", -1, &stmt, nil)
                == SQLITE_OK
        )
    }

    /// A connection that cannot sort is refused outright, like a failed open,
    /// rather than handed out to fail every text-sorted page at prepare.
    @Test func refusesAConnectionWhoseCollationFailedToRegister() {
        #expect(OfflineStore.connect(path: ":memory:", register: { _ in false }) == nil)
    }
}

// MARK: - Schema upgrade

/// The mirror tables as the build before the sort columns shipped wrote them.
private let preUpgradeMirrorSchema = ["books", "books_staging"].map { table in
    """
    CREATE TABLE \(table) (
        uuid         TEXT PRIMARY KEY,
        title        TEXT NOT NULL DEFAULT '',
        author       TEXT NOT NULL DEFAULT '',
        series       TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0,
        added_at     TEXT NOT NULL DEFAULT '',
        modified     TEXT NOT NULL DEFAULT '',
        last_interacted TEXT NOT NULL DEFAULT '',
        formats      TEXT NOT NULL DEFAULT '',
        search_text  TEXT NOT NULL DEFAULT '',
        payload      BLOB NOT NULL
    );
    """
}.joined(separator: "\n")

/// The column names of `table` in `db`, in declaration order.
private func columns(_ db: OpaquePointer?, _ table: String) -> [String] {
    var stmt: OpaquePointer?
    defer { sqlite3_finalize(stmt) }
    guard sqlite3_prepare_v2(db, "PRAGMA table_info(\(table))", -1, &stmt, nil) == SQLITE_OK
    else { return [] }
    var out: [String] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        out.append(String(cString: sqlite3_column_text(stmt, 1)))
    }
    return out
}

struct MirrorSchemaUpgradeTests {
    @Test func upgradeAddsTheSortColumnsToBothTablesAndPromotionStaysAligned() async throws {
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("mirror-upgrade-\(UUID().uuidString).sqlite").path
        defer { try? FileManager.default.removeItem(atPath: path) }
        var seed: OpaquePointer?
        guard sqlite3_open(path, &seed) == SQLITE_OK else {
            Issue.record("could not create the pre-upgrade database")
            return
        }
        let created = sqlite3_exec(seed, preUpgradeMirrorSchema, nil, nil, nil)
        sqlite3_close(seed)
        guard created == SQLITE_OK else {
            Issue.record("could not create the pre-upgrade mirror tables")
            return
        }

        let store = OfflineStore(path: path)
        await store.open()
        #expect(await store.isOpen)

        var book = Book(id: 1, filename: "a.epub", title: "Apple", uniqueIdentifier: "u1")
        book.series = "Dune"
        book.creators = [Contributor(name: "Andy Weir", fileAs: "Andy Weir")]
        await store.appendStagedBooks([LibraryIndex.row(for: book, payload: Data("{}".utf8))])
        await store.promoteCompletedStaging()
        #expect(await store.bookCount() == 1)

        var db: OpaquePointer?
        guard sqlite3_open(path, &db) == SQLITE_OK else {
            Issue.record("could not reopen the upgraded database")
            return
        }
        defer { sqlite3_close(db) }
        for table in ["books", "books_staging"] {
            let names = columns(db, table)
            for column in ["author_sort", "title_sort", "series_sort"] {
                #expect(names.contains(column), "\(table) lacks \(column)")
            }
            #expect(names == columns(db, "books"), "\(table) out of step with books")
        }

        // The positional swap must land each value in its own column.
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard
            sqlite3_prepare_v2(
                db, "SELECT title, title_sort, author_sort, series_sort FROM books", -1, &stmt, nil
            ) == SQLITE_OK, sqlite3_step(stmt) == SQLITE_ROW
        else {
            Issue.record("could not read the promoted row")
            return
        }
        let promoted = (0..<4).map { String(cString: sqlite3_column_text(stmt, $0)) }
        #expect(promoted == ["apple", "Apple", "Weir, Andy", "Dune"])
    }
}
