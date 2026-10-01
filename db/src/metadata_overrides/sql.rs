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

/// `$mo.overrides`, coerced to an empty object when it does not parse, so no
/// `json_*` read of it can abort the query. The guard goes on the argument: a
/// `WHERE json_valid(…)` filter may be evaluated after the read it guards.
macro_rules! safe_overrides_sql {
    ($mo:literal) => {
        concat!(
            "(CASE WHEN json_valid(",
            $mo,
            ".overrides) THEN ",
            $mo,
            ".overrides ELSE '{}' END)"
        )
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

/// Does this book carry a winning override for the text field at `$path`? A
/// string is the one shape serde reads into `Some`, so the empty string counts
/// as present — it is the edit form's clear, not an absent key. `IS`, so a
/// book with no overrides row reads false rather than NULL under a `NOT`.
macro_rules! override_present_sql {
    ($path:literal) => {
        concat!(
            "(",
            overrides_win_sql!(),
            " AND json_type(CASE WHEN json_valid(mo.overrides) THEN mo.overrides ELSE '{}' END, '",
            $path,
            "') IS 'text')"
        )
    };
}

/// The *displayed* value of one text field: a present override outright —
/// NULL when it is the empty clear, never the scanned value it cleared, as in
/// `apply_overrides` — and the scanned column otherwise.
macro_rules! effective_value_sql {
    ($path:literal ; $scanned:literal) => {
        concat!(
            "(CASE WHEN ",
            override_present_sql!($path),
            " THEN NULLIF(json_extract(mo.overrides, '",
            $path,
            "'), '') ELSE ",
            $scanned,
            " END)"
        )
    };
}

/// [`effective_value_sql`] with a collation stated, because a `CASE`
/// expression carries no implicit one — without it the text axes would
/// silently become case-sensitive, unlike the NOCASE columns they wrap.
/// `NOCASE` unless named; a sort axis names `dictionary` (see `pool.rs`).
macro_rules! effective_text_sql {
    ($path:literal ; $scanned:literal) => {
        effective_text_sql!($path ; $scanned ; "NOCASE")
    };
    ($path:literal ; $scanned:literal ; $collation:literal) => {
        concat!(effective_value_sql!($path ; $scanned), " COLLATE ", $collation)
    };
}

/// SQL mirror of `creator_sort_key`'s choice of *which* string keys an author:
/// `file_as` only in comma form, else the display name, else `file_as`. The
/// surname-first reshape itself is left to the `author_dictionary` collation,
/// which runs the Rust `author_sort_key` — so the SQL and Rust keys cannot
/// drift. Both arguments are SQL expressions; NULL reads as absent.
macro_rules! creator_sort_sql {
    ($file_as:expr, $name:expr) => {
        concat!(
            "CASE WHEN instr(",
            $file_as,
            ", ',') > 0 THEN ",
            $file_as,
            " ELSE COALESCE(NULLIF(trim(",
            $name,
            "), ''), ",
            $file_as,
            ") END"
        )
    };
}

/// The Author sort axis: the author a book is *displayed* under, in
/// `author_dictionary` order, so an edited book whose name was typed as
/// `Andy Weir` files beside the scanned `Weir, Andy`.
///
/// A creators override replaces the list wholesale, the empty list included,
/// so while one is present (the key holds an array, the shape serde reads as
/// `Some`) the axis is its first creator — NULL for an emptied list, filed
/// with the other authorless books — and the scanned `author_sort` only when
/// there is none. `effective_tags_sql!`'s presence test, for the same reason.
macro_rules! effective_author_sql {
    ($scanned:literal) => {
        concat!(
            "(CASE WHEN ",
            overrides_win_sql!(),
            " AND json_type(CASE WHEN json_valid(mo.overrides) THEN mo.overrides ELSE '{}' END,",
            " '$.creators') = 'array' THEN ",
            creator_sort_sql!(
                override_sql!("$.creators[0].file_as"),
                override_sql!("$.creators[0].name")
            ),
            " ELSE ",
            $scanned,
            " END) COLLATE author_dictionary"
        )
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

/// Effective `(book_id, author_id)` membership — who a book is *by* on every
/// surface that credits it: the canonical link rows for a book with no
/// creators override (or whose scan root ranks it below the scan), the
/// override's creator names resolved (NOCASE) to `authors` rows otherwise;
/// `materialize_author_rows` guarantees the row. Same `'array'` presence test
/// as [`effective_tags_sql`]. The `je.type` guard sits in the argument because
/// the join may be evaluated before any `WHERE`.
macro_rules! effective_authors_sql {
    () => {
        concat!(
            "SELECT bal.book AS book_id, bal.author AS author_id
               FROM books_authors_link bal
               JOIN books b ON b.id = bal.book
               JOIN scan_roots l ON l.id = b.library_id
               LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
              WHERE json_type(CASE WHEN json_valid(mo.overrides)
                                   THEN mo.overrides ELSE '{}' END, '$.creators') IS NOT 'array'
                 OR NOT ",
            overrides_win_sql!(),
            " UNION
             SELECT b.id AS book_id, a.id AS author_id
               FROM books b
               JOIN scan_roots l ON l.id = b.library_id
               JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
               JOIN json_each(CASE WHEN json_valid(mo.overrides)
                                   THEN mo.overrides ELSE '{}' END, '$.creators') je
               JOIN authors a
                 ON a.name = CASE WHEN je.type = 'object'
                                  THEN json_extract(je.value, '$.name') END COLLATE NOCASE
              WHERE ",
            overrides_win_sql!(),
            " AND json_type(CASE WHEN json_valid(mo.overrides)
                                 THEN mo.overrides ELSE '{}' END, '$.creators') = 'array'"
        )
    };
}

/// Effective `(book_id, series_id)` membership: the canonical link rows for a
/// book with no series override, the `series` row the override names (NOCASE)
/// otherwise — none for the empty clear. The presence test is the Series sort
/// axis' own, so a book is held under the series it sorts and displays under.
macro_rules! effective_series_sql {
    () => {
        concat!(
            "SELECT bsl.book AS book_id, bsl.series AS series_id
               FROM books_series_link bsl
               JOIN books b ON b.id = bsl.book
               JOIN scan_roots l ON l.id = b.library_id
               LEFT JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
              WHERE NOT ",
            override_present_sql!("$.series"),
            " UNION
             SELECT b.id AS book_id, s.id AS series_id
               FROM books b
               JOIN scan_roots l ON l.id = b.library_id
               JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
               JOIN series s
                 ON s.name = json_extract(CASE WHEN json_valid(mo.overrides)
                                               THEN mo.overrides ELSE '{}' END, '$.series')
                    COLLATE NOCASE
              WHERE ",
            override_present_sql!("$.series")
        )
    };
}

pub(crate) use {
    creator_sort_sql, effective_author_sql, effective_authors_sql, effective_genres_sql,
    effective_series_sql, effective_tags_sql, effective_text_sql, effective_value_sql,
    override_join_sql, override_present_sql, override_sql, overrides_win_sql, safe_overrides_sql,
};

#[cfg(test)]
mod tests;
