//! Tags arm of the search palette: substring `LIKE` match scoped to the
//! visible books, ordered by an override-aware effective book count. A tag is
//! listed when it has at least one effective member on a visible book, so a
//! tag a reader added through the app counts the same as a scanned one.

use std::sync::OnceLock;

use omnibus_shared::PaletteTagHit;
use sqlx::{Row, SqlitePool};

use crate::helpers::{library_paths_json, visible_book_sql};
// `overrides_win_sql` is expanded *by* `effective_tags_sql!` — a nested
// `macro_rules!` name resolves at the expansion site, so it must be in scope
// here even though nothing in this file names it directly.
use crate::metadata_overrides::sql::{effective_tags_sql, overrides_win_sql};

use super::PaletteError;

/// Tags-arm palette query, bound `?1 = library_paths JSON array`, `?2 = like_pattern`,
/// `?3 = limit`.
///
/// Both the count and the visibility gate read the shared effective-membership
/// relation, so an override that replaces a book's subjects wholesale — the
/// empty array included, which clears them — moves the listing and the count
/// together. Requiring a canonical `books_tags_link` row instead would hide a
/// tag that exists only in override JSON, which is a tag the reader just added.
pub(super) fn search_tags_sql() -> &'static str {
    static SQL: OnceLock<String> = OnceLock::new();
    SQL.get_or_init(|| {
        let vis = visible_book_sql("b", "l", "?1");
        format!(
            r"
        WITH visible_books AS (
          SELECT b.id AS book_id
            FROM books b
            JOIN scan_roots l ON l.id = b.library_id
           WHERE {vis}
        ),
        effective AS MATERIALIZED (
          SELECT et.book_id, et.tag_id
            FROM ({effective}) et
            JOIN visible_books vb ON vb.book_id = et.book_id
        )
        SELECT t.id, t.name,
          (SELECT COUNT(*) FROM effective e WHERE e.tag_id = t.id) AS book_count
        FROM tags t
        WHERE t.name LIKE ?2 ESCAPE '\'
          AND EXISTS (SELECT 1 FROM effective e WHERE e.tag_id = t.id)
        ORDER BY book_count DESC, t.name
        LIMIT ?3
        ",
            effective = effective_tags_sql!()
        )
    })
}

/// Run the tags arm of the palette for `like_pattern` (already escaped)
/// scoped to `library_path`, capped to `limit`.
pub async fn search_tags(
    pool: &SqlitePool,
    library_path: &str,
    like_pattern: &str,
    limit: i32,
) -> Result<Vec<PaletteTagHit>, PaletteError> {
    search_tags_for_paths(pool, &[library_path], like_pattern, limit).await
}

/// Run the tags arm across every configured library path.
pub async fn search_tags_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    like_pattern: &str,
    limit: i32,
) -> Result<Vec<PaletteTagHit>, PaletteError> {
    if library_paths.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(search_tags_sql())
        .bind(library_paths_json(library_paths))
        .bind(like_pattern)
        .bind(limit)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .iter()
        .map(|r| PaletteTagHit {
            id: r.get("id"),
            name: r.get("name"),
            book_count: u32::try_from(r.get::<i32, _>("book_count")).unwrap_or(0),
        })
        .collect())
}

/// Count visible tags matching `like_pattern` in `library_path` — the
/// uncapped total behind the palette's 5-hit tag cap. Visibility mirrors
/// [`search_tags`]: at least one effective member on a visible book.
pub async fn count_tags(
    pool: &SqlitePool,
    library_path: &str,
    like_pattern: &str,
) -> Result<i64, PaletteError> {
    count_tags_for_paths(pool, &[library_path], like_pattern).await
}

/// Count visible matching tags across every configured library path.
pub async fn count_tags_for_paths(
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
        WITH visible_books AS (
          SELECT b.id AS book_id
            FROM books b
            JOIN scan_roots l ON l.id = b.library_id
           WHERE {visible}
        ),
        effective AS MATERIALIZED (
          SELECT et.book_id, et.tag_id
            FROM ({effective}) et
            JOIN visible_books vb ON vb.book_id = et.book_id
        )
        SELECT COUNT(*) FROM tags t
        WHERE t.name LIKE ?2 ESCAPE '\'
          AND EXISTS (SELECT 1 FROM effective e WHERE e.tag_id = t.id)
        ",
        effective = effective_tags_sql!()
    ))
    .bind(library_paths_json(library_paths))
    .bind(like_pattern)
    .fetch_one(pool)
    .await?)
}
