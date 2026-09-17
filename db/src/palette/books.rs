//! FTS5 books path for the search palette: BM25-ranked title/author/series
//! matches with override-aware overlays applied after hydration so the
//! palette row matches what the rest of the app renders. A `tag:`/`genre:`
//! facet is answered from effective membership instead, so the palette and
//! the REST search agree on what a facet means.

use std::sync::OnceLock;

use omnibus_shared::PaletteBookHit;
use sqlx::{Row, SqlitePool};

use crate::books::parse_json_array;
use crate::helpers::{
    build_search_query, facet_exists_predicates, library_paths_json, visible_book_sql, SearchQuery,
    FTS_BM25_RANK,
};
use crate::metadata_overrides::load_overrides_bulk;
use crate::pubdate::year_of;

use super::PaletteError;

/// The projection every books-arm shape returns, so the row reader stays one
/// implementation regardless of which shape produced the row.
const PALETTE_BOOK_COLUMNS: &str = r"
        SELECT b.id, b.uuid, b.title, b.has_cover, b.accent_color,
               b.pubdate                AS pubdate,

               (SELECT GROUP_CONCAT(a.name, ', ')
                  FROM (SELECT a2.name FROM books_authors_link bal
                          JOIN authors a2 ON a2.id = bal.author
                         WHERE bal.book = b.id
                         ORDER BY bal.position) a)          AS author_display,

               (SELECT json_group_array(format)
                  FROM (SELECT format FROM book_files
                         WHERE book_id = b.id
                         ORDER BY format))                  AS formats_json,

               EXISTS (SELECT 1 FROM physical_copies pc
                        WHERE pc.book_uuid = b.uuid)        AS has_physical,

               (SELECT COUNT(*) FROM matches)               AS total_count
";

/// FTS5 books-arm palette query for a free-text (or `author:`/`series:`) query
/// with no relational facet: bound `?1 = match_expr`,
/// `?2 = library_paths JSON array`, `?3 = limit`. The `bm25` MATCH scan runs
/// once inside a `MATERIALIZED` CTE and `total_count` is a scalar `COUNT(*)`
/// over it, so the true (pre-cap) match total ships on every row alongside the
/// capped result set.
fn search_books_sql() -> &'static str {
    static SQL: OnceLock<String> = OnceLock::new();
    SQL.get_or_init(|| {
        let visible = visible_book_sql("b", "l", "?2");
        format!(
            r"
        WITH matches AS MATERIALIZED (
            SELECT books_fts.rowid AS bid,
                   {FTS_BM25_RANK} AS rank
            FROM books_fts
            JOIN books b ON b.id = books_fts.rowid
            JOIN scan_roots l ON l.id = b.library_id
            WHERE books_fts MATCH ?1
              AND {visible}
        )
        {PALETTE_BOOK_COLUMNS}
        FROM matches m
        JOIN books b ON b.id = m.bid
        ORDER BY m.rank, b.sort, b.id
        LIMIT ?3
        "
        )
    })
}

/// The two facet-bearing shapes, built per call because the number of
/// `EXISTS` predicates varies with the query. Positional `?` throughout:
/// match (when present), then paths, then one bind per facet, then the limit.
///
/// A facets-only query drops the `books_fts` join entirely — FTS5 rejects an
/// empty `MATCH`, and with no rank to order by the library's own sort carries
/// the order.
fn faceted_books_sql(query: &SearchQuery, facets: &str) -> String {
    let visible = visible_book_sql("b", "l", "?");
    if query.fts_match.is_some() {
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
        {PALETTE_BOOK_COLUMNS}
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
        {PALETTE_BOOK_COLUMNS}
        FROM matches m
        JOIN books b ON b.id = m.bid
        ORDER BY b.sort, b.id
        LIMIT ?
        "
        )
    }
}

/// Run the FTS5 books arm of the palette for `trimmed` (already-trimmed,
/// length-capped query) scoped to `library_path`, capped to `limit`.
///
/// Returns the (capped) display hits alongside the *true* match count
/// (before the cap), computed in a single pass: the scan runs once inside a
/// `MATERIALIZED` CTE and the total is a scalar `COUNT(*)` over it — so the
/// results header can show "N books" even when only `limit` ship.
/// Returns `(vec![], 0)` when the input parses to nothing to run.
pub async fn search_books(
    pool: &SqlitePool,
    library_path: &str,
    trimmed: &str,
    limit: i32,
) -> Result<(Vec<PaletteBookHit>, i64), PaletteError> {
    search_books_for_paths(pool, &[library_path], trimmed, limit).await
}

/// Run the books arm across every configured library path.
pub async fn search_books_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    trimmed: &str,
    limit: i32,
) -> Result<(Vec<PaletteBookHit>, i64), PaletteError> {
    if library_paths.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let query = build_search_query(trimmed);
    if query.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let (facets, facet_binds) = facet_exists_predicates(&query);

    let rows = if facet_binds.is_empty() {
        sqlx::query(search_books_sql())
            .bind(query.fts_match.as_deref().unwrap_or_default())
            .bind(library_paths_json(library_paths))
            .bind(limit)
            .fetch_all(pool)
            .await?
    } else {
        let sql = faceted_books_sql(&query, &facets);
        let mut q = sqlx::query(&sql);
        if let Some(match_expr) = &query.fts_match {
            q = q.bind(match_expr.clone());
        }
        q = q.bind(library_paths_json(library_paths));
        for value in &facet_binds {
            q = q.bind(value.clone());
        }
        q.bind(limit).fetch_all(pool).await?
    };

    // `total_count` is the scalar COUNT over the materialized matches, so it's
    // identical on every row; read it off the first. No rows ⇒ zero matches.
    let total: i64 = rows.first().map(|r| r.get("total_count")).unwrap_or(0);

    let mut uuids: Vec<String> = Vec::with_capacity(rows.len());
    let mut hits: Vec<PaletteBookHit> = Vec::with_capacity(rows.len());
    for r in rows.iter() {
        let id: i64 = r.get("id");
        let uuid: String = r.get("uuid");
        let has_cover: i64 = r.get("has_cover");
        uuids.push(uuid.clone());
        hits.push(PaletteBookHit {
            id,
            uuid: uuid.clone(),
            title: r.get::<Option<String>, _>("title").unwrap_or_default(),
            author_display: r
                .get::<Option<String>, _>("author_display")
                .unwrap_or_default(),
            // Not `SUBSTR(pubdate, 1, 4)`: a physical-only row written before
            // the date was normalized holds `8/4/2015`, and that answered
            // "8/4/" (#2510).
            year: r
                .get::<Option<String>, _>("pubdate")
                .as_deref()
                .and_then(year_of),
            formats: parse_json_array(r.get("formats_json"))?,
            cover_url: (has_cover != 0).then(|| format!("/api/covers/{uuid}")),
            accent: r.get("accent_color"),
            has_physical: r.get::<i64, _>("has_physical") != 0,
        });
    }

    apply_override_overlays(pool, &mut hits, &uuids).await?;

    Ok((hits, total))
}

/// Overlay override-aware title / author / cover onto each hydrated hit, so a
/// palette row matches what the rest of the app renders. Mirrors
/// `apply_overrides`, including surfacing a user-uploaded cover even when the
/// scanned book had `has_cover = 0`. `hits` and `uuids` are index-aligned.
async fn apply_override_overlays(
    pool: &SqlitePool,
    hits: &mut [PaletteBookHit],
    uuids: &[String],
) -> Result<(), PaletteError> {
    let overrides_map = load_overrides_bulk(pool, uuids).await?;
    for (hit, uuid) in hits.iter_mut().zip(uuids.iter()) {
        if let Some((ov, has_cover_ov)) = overrides_map.get(uuid) {
            if let Some(ref t) = ov.title {
                hit.title = t.clone();
            }
            if let Some(ref creators) = ov.creators {
                hit.author_display = creators
                    .iter()
                    .map(|c| c.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
            }
            if *has_cover_ov {
                hit.cover_url = Some(format!("/api/covers/{}", hit.uuid));
            }
        }
    }
    Ok(())
}
