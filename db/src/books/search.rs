//! FTS5-backed search read path. Wraps the `books_fts` virtual table with
//! the same scalar-subquery projection the other read paths use, so search
//! results hydrate into the same `EbookMetadata` shape `list_books` /
//! `get_book` return. Free text, `author:` and `series:` go to FTS; `tag:`
//! and `genre:` are resolved relationally, since exact membership is not a
//! question the joined name list in `books_fts.tags` can answer.

use omnibus_shared::EbookMetadata;
use sqlx::{Row, SqlitePool};

use crate::helpers::{
    build_search_query, cap_query_len, facet_exists_predicates, library_paths_json,
    visible_book_sql, SearchQuery, FTS_BM25_RANK,
};

use super::projection::{
    backfill_creator_ids, merge_overrides_into_books, row_to_ebook, BOOK_COLUMNS,
    MAX_BOOKS_RETURNED,
};

/// Full-text search across `books_fts`: hydrated `EbookMetadata` ordered by bm25
/// rank (see [`FTS_BM25_RANK`]) for free text, or by the library's own sort for
/// facets alone. `q` is parsed via [`build_search_query`] (`author:`, `series:`,
/// `tag:`, `genre:` facets), which sanitises every token, so arbitrary user
/// input is safe. Empty vec when the parsed query is empty.
pub async fn search_books(
    pool: &SqlitePool,
    library_path: &str,
    q: &str,
) -> Result<Vec<EbookMetadata>, super::BooksError> {
    search_books_for_paths(pool, &[library_path], q).await
}

/// Full-text search across every configured library path.
pub async fn search_books_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    q: &str,
) -> Result<Vec<EbookMetadata>, super::BooksError> {
    let (books, _total) = search_books_for_paths_with_total(pool, library_paths, q).await?;
    Ok(books)
}

/// Same as [`search_books`] but also returns the *true* FTS5 hit count (before
/// the `MAX_BOOKS_RETURNED` cap), from a single FTS5 pass, so the REST handler
/// and RPC server function need no second `count_search_books` query. Empty or
/// oversized `q` yields `(vec![], 0)`, as in `search_books`.
pub async fn search_books_with_total(
    pool: &SqlitePool,
    library_path: &str,
    q: &str,
) -> Result<(Vec<EbookMetadata>, i64), super::BooksError> {
    search_books_for_paths_with_total(pool, &[library_path], q).await
}

/// Search across `library_paths` and return capped rows plus the true hit count.
pub async fn search_books_for_paths_with_total(
    pool: &SqlitePool,
    library_paths: &[&str],
    q: &str,
) -> Result<(Vec<EbookMetadata>, i64), super::BooksError> {
    if library_paths.is_empty() {
        return Ok((Vec::new(), 0));
    }
    // Cap query length before parsing to bound the FTS5 MATCH expression size,
    // matching `search_palette` (issue #189). Normal/short queries are
    // unaffected; see `cap_query_len`.
    let capped = cap_query_len(q);
    let query = build_search_query(&capped);
    if query.is_empty() {
        return Ok((Vec::new(), 0));
    }

    let rows = fetch_search_rows(pool, library_paths, &query).await?;

    // `total_count` is the scalar `COUNT(*)` over the materialized matches, so
    // it's identical on every row; read it off the first. An empty result set
    // means zero matches.
    let total: i64 = rows.first().map(|r| r.get("total_count")).unwrap_or(0);

    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        out.push(row_to_ebook(r)?);
    }

    merge_overrides_into_books(pool, &mut out).await?;
    backfill_creator_ids(pool, &mut out).await?;

    Ok((out, total))
}

/// Run the single-pass match + hydrate query: the bm25 scan lives in a
/// `MATERIALIZED` CTE that the outer SELECT joins back to `books`, adding a
/// scalar `total_count` column. A facets-only query has no `books_fts` join
/// and orders by the library's own sort (FTS5 rejects an empty `MATCH`).
async fn fetch_search_rows(
    pool: &SqlitePool,
    library_paths: &[&str],
    query: &SearchQuery,
) -> Result<Vec<sqlx::sqlite::SqliteRow>, sqlx::Error> {
    let visible = visible_book_sql("b", "l", "?");
    let (facets, facet_binds) = facet_exists_predicates(query);
    // `bm25()` is only valid in a query that directly references `books_fts`,
    // so the scan lives inside the CTE.
    let sql = if query.fts_match.is_some() {
        format!(
            r"
        WITH matches AS MATERIALIZED (
            SELECT books_fts.rowid AS bid,
                   {FTS_BM25_RANK} AS rank
            FROM books_fts
            JOIN books b ON b.id = books_fts.rowid
            JOIN scan_roots l ON l.id = b.library_id
            WHERE books_fts MATCH ?
              AND {visible}{facets}
        )
        SELECT {BOOK_COLUMNS},
               (SELECT COUNT(*) FROM matches)               AS total_count
        FROM matches m
        JOIN books b ON b.id = m.bid
        ORDER BY m.rank, b.sort, b.id
        LIMIT ?
        "
        )
    } else {
        format!(
            r"
        WITH matches AS MATERIALIZED (
            SELECT b.id AS bid
            FROM books b
            JOIN scan_roots l ON l.id = b.library_id
            WHERE {visible}{facets}
        )
        SELECT {BOOK_COLUMNS},
               (SELECT COUNT(*) FROM matches)               AS total_count
        FROM matches m
        JOIN books b ON b.id = m.bid
        ORDER BY b.sort, b.id
        LIMIT ?
        "
        )
    };
    let mut q = sqlx::query(&sql);
    if let Some(match_expr) = &query.fts_match {
        q = q.bind(match_expr);
    }
    q = q.bind(library_paths_json(library_paths));
    for value in &facet_binds {
        q = q.bind(value);
    }
    q.bind(MAX_BOOKS_RETURNED).fetch_all(pool).await
}

/// Total number of FTS5 hits for `q` under `library_path` (before the
/// `MAX_BOOKS_RETURNED` cap is applied). Empty/whitespace `q` returns 0
/// to mirror `search_books`.
pub async fn count_search_books(
    pool: &SqlitePool,
    library_path: &str,
    q: &str,
) -> Result<i64, super::BooksError> {
    count_search_books_for_paths(pool, &[library_path], q).await
}

/// Count FTS5 hits across every configured library path.
pub async fn count_search_books_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    q: &str,
) -> Result<i64, super::BooksError> {
    if library_paths.is_empty() {
        return Ok(0);
    }
    // Cap query length before parsing to mirror `search_books` /
    // `search_palette` (issue #189). Normal/short queries are unaffected;
    // see `cap_query_len`.
    let capped = cap_query_len(q);
    let query = build_search_query(&capped);
    if query.is_empty() {
        return Ok(0);
    }
    let visible = visible_book_sql("b", "l", "?");
    let (facets, facet_binds) = facet_exists_predicates(&query);
    let sql = if query.fts_match.is_some() {
        format!(
            r"
        SELECT COUNT(*)
          FROM books_fts
          JOIN books b ON b.id = books_fts.rowid
          JOIN scan_roots l ON l.id = b.library_id
         WHERE books_fts MATCH ?
           AND {visible}{facets}
        "
        )
    } else {
        format!(
            r"
        SELECT COUNT(*)
          FROM books b
          JOIN scan_roots l ON l.id = b.library_id
         WHERE {visible}{facets}
        "
        )
    };
    let mut scalar = sqlx::query_scalar::<_, i64>(&sql);
    if let Some(match_expr) = &query.fts_match {
        scalar = scalar.bind(match_expr.clone());
    }
    scalar = scalar.bind(library_paths_json(library_paths));
    for value in &facet_binds {
        scalar = scalar.bind(value.clone());
    }
    Ok(scalar.fetch_one(pool).await?)
}
