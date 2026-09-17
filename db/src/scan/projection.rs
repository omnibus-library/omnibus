//! The `ScanBook` projection every rung of the matching ladder selects, and
//! the liveness predicate that decides which `books` rows a rung may offer.
//! Shared by the exact-identifier and norm rungs in [`super::resolve`] so
//! the two cannot disagree about what a library match looks like.

use omnibus_shared::scan::ScanBook;
use sqlx::Row;

use crate::metadata_overrides::sql::overrides_win_sql;

/// A `books` row the rest of the app treats as present: it has a file, a
/// physical copy, or somebody's wishlist entry.
///
/// The listing, search and the Authors index all apply the file-or-copy half
/// of this; the wishlist half keeps a book that exists only to be wanted
/// reachable by the ISBN rung, which is how a wish becomes a copy. A row with
/// none of the three — a ghosted book whose file went away, or an orphan left
/// by an older write path — appears on no reader surface, so offering it as
/// "this one's already in your library" files a copy against a book nothing
/// else can reach (#2497).
///
/// Interpolated into a query that aliases `books` as `b`.
pub(super) const LIVE_BOOK: &str = "(EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)
        OR EXISTS (SELECT 1 FROM physical_copies pc WHERE pc.book_uuid = b.uuid)
        OR EXISTS (SELECT 1 FROM wishlist_entries we WHERE we.book_uuid = b.uuid))";

/// The separator the author subqueries join names on — a control character
/// rather than `", "`, because a stored sort-form name carries the comma
/// itself: split on `", "`, `Weir, Andy` became two people (#2460).
const AUTHOR_SEP: char = '\u{1f}';

/// The `SELECT` list producing one [`ScanBook`] per `books b` row.
///
/// `effective` reads the displayed title and creators through the override
/// layer, so the confirm card names the book the way its detail page does;
/// it requires `scan_roots l` and `metadata_overrides mo` joined (`LEFT` is
/// fine — an unjoined row falls through to the scanned columns). Without it
/// the scanned columns are selected directly, which is exact for a row that
/// has no override and keeps the no-override arm on `idx_books_norm`.
///
/// `with_isbn` adds the correlated identifier subquery the close-match
/// screen shows beside the scanned ISBN; the exact rung has no reader for it
/// and skips the cost.
pub(super) fn scan_book_cols(effective: bool, with_isbn: bool) -> String {
    // Not `effective_text_sql!`: that reads the blob unguarded, and a corrupt
    // one must fail the override, not the lookup (#2556).
    let title = if effective {
        format!(
            "COALESCE(NULLIF(CASE WHEN {win} THEN json_extract({SAFE_OVERRIDES}, '$.title') END, ''),
                      b.title) COLLATE NOCASE",
            win = overrides_win_sql!(),
        )
    } else {
        "b.title".to_string()
    };
    let authors = if effective {
        format!(
            "CASE WHEN {win} AND json_type({SAFE_OVERRIDES}, '$.creators') = 'array'
                  THEN (SELECT group_concat(json_extract(je.value, '$.name'), char(31))
                          FROM json_each({SAFE_OVERRIDES}, '$.creators') je)
                  ELSE {LINKED_AUTHORS} END",
            win = overrides_win_sql!(),
        )
    } else {
        LINKED_AUTHORS.to_string()
    };
    let isbn = if with_isbn {
        "(SELECT REPLACE(REPLACE(bi2.value, '-', ''), ' ', '')
            FROM book_identifiers bi2
           WHERE bi2.book_id = b.id AND bi2.scheme LIKE '%isbn%'
             AND REPLACE(REPLACE(bi2.value, '-', ''), ' ', '')
                 GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
           ORDER BY bi2.rowid LIMIT 1)"
    } else {
        "NULL"
    };
    format!(
        "b.uuid AS uuid, {title} AS title, b.has_cover AS has_cover, {authors} AS authors,
         EXISTS (SELECT 1 FROM physical_copies pc WHERE pc.book_uuid = b.uuid) AS has_physical,
         EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id) AS has_files,
         {isbn} AS isbn"
    )
}

/// The override blob, coerced to an empty object when it does not parse, so
/// neither `json_extract` nor `json_each` can abort the query on it.
const SAFE_OVERRIDES: &str = "CASE WHEN json_valid(mo.overrides) THEN mo.overrides ELSE '{}' END";

/// The scanned author list in link order. Wrapped in a subquery so the
/// `ORDER BY` governs `group_concat`, which an aggregate over an ordered
/// `FROM` does not promise.
const LINKED_AUTHORS: &str = "(SELECT group_concat(name, char(31))
            FROM (SELECT a.name FROM books_authors_link bal
                    JOIN authors a ON a.id = bal.author
                   WHERE bal.book = b.id ORDER BY bal.position))";

/// One [`scan_book_cols`] row as a [`ScanBook`], dropping an empty ISBN.
pub(super) fn row_to_scan_book(r: sqlx::sqlite::SqliteRow) -> ScanBook {
    let uuid: String = r.get("uuid");
    let has_cover: i64 = r.get("has_cover");
    let authors: Option<String> = r.get("authors");
    let has_physical: i64 = r.get("has_physical");
    let has_files: i64 = r.get("has_files");
    let isbn = r.get::<Option<String>, _>("isbn").filter(|s| !s.is_empty());
    ScanBook {
        cover_url: (has_cover != 0).then(|| format!("/api/covers/{uuid}")),
        isbn,
        authors: authors
            .map(|s| {
                s.split(AUTHOR_SEP)
                    .map(str::trim)
                    .filter(|a| !a.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        title: r.get("title"),
        has_physical: has_physical != 0,
        has_files: has_files != 0,
        uuid,
    }
}
