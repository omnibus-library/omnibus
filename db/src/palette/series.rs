//! Series arm of the search palette: substring `LIKE` match with
//! override-aware book count plus an author_display drawn from the
//! first book's effective creators. Visibility still requires at least
//! one canonical link on a visible book.

use std::sync::OnceLock;

use omnibus_shared::PaletteSeriesHit;
use sqlx::{Row, SqlitePool};

use crate::helpers::{library_paths_json, visible_book_sql};
// The membership fragment expands the precedence and presence macros at this
// site, so those must be in scope here too.
use crate::metadata_overrides::sql::{
    effective_series_sql, override_present_sql, overrides_win_sql, safe_overrides_sql,
};

use super::PaletteError;

/// Series-arm palette query, bound `?1 = library_paths JSON array`, `?2 = like_pattern`,
/// `?3 = limit`.
///
/// The count reads the shared effective membership (`effective_series_sql!`)
/// narrowed to the visible books — the relation the Series index and
/// smart-shelf series rules read — so a book rehomed through the edit form
/// moves between the two counts, and an emptied series override drops it
/// from both. The `author_display` line follows the first book's creators
/// override. Visibility still requires at least one canonical link on a
/// visible book so we don't list series that exist only inside override JSON
/// (no navigable id).
pub(super) fn search_series_sql() -> &'static str {
    static SQL: OnceLock<String> = OnceLock::new();
    SQL.get_or_init(|| {
        let vis = visible_book_sql("b", "l", "?1");
        let vis_author = visible_book_sql("b2", "l2", "?1");
        let vis_lead = visible_book_sql("b3", "l3", "?1");
        format!(
            r"
        WITH effective AS MATERIALIZED (
          SELECT es.series_id, es.book_id
            FROM ({membership}) es
            JOIN books b ON b.id = es.book_id
            JOIN scan_roots l ON l.id = b.library_id
           WHERE {vis}
        )
        SELECT s.id, s.name,
          (SELECT COUNT(*) FROM effective e WHERE e.series_id = s.id) AS book_count,
          (SELECT
             CASE
               WHEN mo2.book_uuid IS NOT NULL
                    AND json_type({overrides2}, '$.creators') IS NOT NULL
                 THEN json_extract({overrides2}, '$.creators[0].name')
               ELSE (SELECT a.name FROM books_authors_link bal
                       JOIN authors a ON a.id = bal.author
                      WHERE bal.book = b2.id
                      ORDER BY bal.position LIMIT 1)
             END
           FROM books_series_link bsl2
             JOIN books b2 ON b2.id = bsl2.book
             JOIN scan_roots l2 ON l2.id = b2.library_id
             LEFT JOIN metadata_overrides mo2 ON mo2.book_uuid = b2.uuid
            WHERE bsl2.series = s.id
              AND {vis_author}
            ORDER BY b2.sort, b2.id LIMIT 1) AS author_display,
          (SELECT COALESCE(json_extract({overrides3}, '$.title'), b3.title)
             FROM books_series_link bsl3
             JOIN books b3 ON b3.id = bsl3.book
             JOIN scan_roots l3 ON l3.id = b3.library_id
             LEFT JOIN metadata_overrides mo3 ON mo3.book_uuid = b3.uuid
            WHERE bsl3.series = s.id
              AND {vis_lead}
            ORDER BY b3.sort, b3.id LIMIT 1) AS lead_book_title
        FROM series s
        WHERE s.name LIKE ?2 ESCAPE '\'
          AND EXISTS (
            SELECT 1 FROM books_series_link bsl
              JOIN books b ON b.id = bsl.book
              JOIN scan_roots l ON l.id = b.library_id
             WHERE bsl.series = s.id
               AND {vis}
          )
        ORDER BY book_count DESC, s.name
        LIMIT ?3
        ",
            membership = effective_series_sql!(),
            overrides2 = safe_overrides_sql!("mo2"),
            overrides3 = safe_overrides_sql!("mo3"),
        )
    })
}

/// Run the series arm of the palette for `like_pattern` (already escaped)
/// scoped to `library_path`, capped to `limit`.
pub async fn search_series(
    pool: &SqlitePool,
    library_path: &str,
    like_pattern: &str,
    limit: i32,
) -> Result<Vec<PaletteSeriesHit>, PaletteError> {
    search_series_for_paths(pool, &[library_path], like_pattern, limit).await
}

/// Run the series arm across every configured library path.
pub async fn search_series_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    like_pattern: &str,
    limit: i32,
) -> Result<Vec<PaletteSeriesHit>, PaletteError> {
    if library_paths.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(search_series_sql())
        .bind(library_paths_json(library_paths))
        .bind(like_pattern)
        .bind(limit)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .iter()
        .map(|r| PaletteSeriesHit {
            id: r.get("id"),
            name: r.get("name"),
            book_count: u32::try_from(r.get::<i32, _>("book_count")).unwrap_or(0),
            author_display: r.get("author_display"),
            lead_book_title: r.get("lead_book_title"),
        })
        .collect())
}

/// Count visible series matching `like_pattern` in `library_path` — the
/// uncapped total behind the palette's 5-hit series cap. Visibility mirrors
/// [`search_series`]: at least one canonical link on a visible book.
pub async fn count_series(
    pool: &SqlitePool,
    library_path: &str,
    like_pattern: &str,
) -> Result<i64, PaletteError> {
    count_series_for_paths(pool, &[library_path], like_pattern).await
}

/// Count visible matching series across every configured library path.
pub async fn count_series_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    like_pattern: &str,
) -> Result<i64, PaletteError> {
    if library_paths.is_empty() {
        return Ok(0);
    }
    let visible = visible_book_sql("b", "l", "?1");
    Ok(sqlx::query_scalar::<_, i64>(&format!(
        r"
        SELECT COUNT(*) FROM series s
        WHERE s.name LIKE ?2 ESCAPE '\'
          AND EXISTS (
            SELECT 1 FROM books_series_link bsl
              JOIN books b ON b.id = bsl.book
              JOIN scan_roots l ON l.id = b.library_id
             WHERE bsl.series = s.id
               AND {visible}
          )
        "
    ))
    .bind(library_paths_json(library_paths))
    .bind(like_pattern)
    .fetch_one(pool)
    .await?)
}
