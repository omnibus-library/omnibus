//! SQL fragments that read the override layer from inside a query.
//!
//! The Rust read path merges overrides in `upsert::apply_overrides`; these are
//! its mirror for the queries that must *sort*, *group* or *rank* on the
//! displayed value rather than the scanned one. Both sides have to agree —
//! a list ordered by the scanned title and rendered with the overridden one
//! is a list in no order at all — so the precedence gate below is written to
//! match `apply_overrides`' case for case.
//!
//! Every fragment here assumes the querying statement joins `books b`,
//! `scan_roots l` (on `b.library_id`) and `metadata_overrides mo` (on
//! `b.uuid`) — see [`OVERRIDE_JOIN`].

/// The two joins every fragment in this module reads from. A macro rather
/// than a `const` so it composes inside `concat!` with the fragments below.
///
/// `LEFT` on both: a book with no overrides row is the common case, and a
/// query that ranked only the overridden books would answer a different
/// question entirely.
macro_rules! override_join_sql {
    () => {
        " LEFT JOIN scan_roots l ON l.id = b.library_id \
          LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid "
    };
}

/// SQL mirror of `apply_overrides`' precedence gate: does this book's scan
/// root rank `omnibus_overrides` above `embedded_tags`? The stored list is
/// validated whole on write, so a token's byte offset is its rank; a list
/// carrying neither token falls back to overrides-win, as the Rust side does.
///
/// `COALESCE` on the column for the same reason: `merge_overrides_into_books`
/// falls back to `DEFAULT_METADATA_PRECEDENCE` when a book has no precedence
/// of its own, and an unjoined `scan_roots` row must not quietly drop the
/// override instead.
macro_rules! overrides_win_sql {
    () => {
        "(instr(COALESCE(l.metadata_precedence, ''), '\"omnibus_overrides\"') = 0
           OR instr(COALESCE(l.metadata_precedence, ''), '\"embedded_tags\"') = 0
           OR instr(COALESCE(l.metadata_precedence, ''), '\"omnibus_overrides\"')
              > instr(COALESCE(l.metadata_precedence, ''), '\"embedded_tags\"'))"
    };
}

/// The user-facing value of one override field, or NULL when the book has no
/// override for it (or its scan root ranks the override below the scan).
macro_rules! override_sql {
    ($path:literal) => {
        concat!(
            "NULLIF(CASE WHEN ",
            overrides_win_sql!(),
            " THEN json_extract(mo.overrides, '",
            $path,
            "') END, '')"
        )
    };
}

/// An axis keyed on the *displayed* value: the override where one exists, the
/// scanned column otherwise. `COLLATE NOCASE` is restated because a `COALESCE`
/// expression carries no implicit collation — without it the text axes would
/// silently become case-sensitive, unlike the NOCASE columns they wrap.
macro_rules! effective_text_sql {
    ($($path:literal),+ ; $scanned:literal) => {
        concat!("COALESCE(", $(override_sql!($path), ", ",)+ $scanned, ") COLLATE NOCASE")
    };
}

/// Effective `(book_id, tag_id)` membership: the canonical link rows for a
/// book with no subjects override (or whose scan root ranks the override
/// below the scan), the override's subjects resolved to `tags` rows
/// otherwise. Mirrors `apply_overrides`: `subjects: Some(_)` replaces the
/// scanned list wholesale, the empty list included.
///
/// An override is *present* exactly when the key holds an array — the one
/// shape serde will read into `Some(Vec)`. An absent key and an explicit JSON
/// `null` both deserialize to `None`, so both leave the canonical rows in
/// place; `IS NOT 'array'` says that in one clause, and is NULL-safe, so an
/// unreadable blob (coerced to `'{}'`) also keeps the canonical rows.
macro_rules! effective_tags_sql {
    () => {
        concat!(
            "SELECT btl.book AS book_id, btl.tag AS tag_id
               FROM books_tags_link btl
               JOIN books b ON b.id = btl.book
               JOIN scan_roots l ON l.id = b.library_id
               LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
              WHERE json_type(CASE WHEN json_valid(mo.overrides)
                                   THEN mo.overrides ELSE '{}' END, '$.subjects') IS NOT 'array'
                 OR NOT ",
            overrides_win_sql!(),
            " UNION
             SELECT b.id AS book_id, t.id AS tag_id
               FROM books b
               JOIN scan_roots l ON l.id = b.library_id
               JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
               JOIN json_each(CASE WHEN json_valid(mo.overrides)
                                   THEN mo.overrides ELSE '{}' END, '$.subjects') je
               JOIN tags t ON t.name = je.value COLLATE NOCASE
              WHERE ",
            overrides_win_sql!(),
            " AND json_type(CASE WHEN json_valid(mo.overrides)
                                 THEN mo.overrides ELSE '{}' END, '$.subjects') = 'array'
                AND je.type = 'text'"
        )
    };
}

/// Effective `(book_id, genre_id)` membership. Genres have no scanned
/// counterpart — the override JSON is their only storage — so there is no
/// canonical arm; the precedence gate still applies because `apply_overrides`
/// returns early on a root that ranks the scan first, genres included. Same
/// `'array'` test as [`effective_tags_sql`], for the same reason.
macro_rules! effective_genres_sql {
    () => {
        concat!(
            "SELECT b.id AS book_id, g.id AS genre_id
               FROM books b
               JOIN scan_roots l ON l.id = b.library_id
               JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
               JOIN json_each(CASE WHEN json_valid(mo.overrides)
                                   THEN mo.overrides ELSE '{}' END, '$.genres') je
               JOIN genres g ON g.name = je.value COLLATE NOCASE
              WHERE ",
            overrides_win_sql!(),
            " AND json_type(CASE WHEN json_valid(mo.overrides)
                                 THEN mo.overrides ELSE '{}' END, '$.genres') = 'array'
                AND je.type = 'text'"
        )
    };
}

pub(crate) use {
    effective_genres_sql, effective_tags_sql, effective_text_sql, override_join_sql, override_sql,
    overrides_win_sql,
};

#[cfg(test)]
mod tests;
