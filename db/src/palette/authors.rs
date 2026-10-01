//! Authors arm of the search palette: substring `LIKE` match scoped to the
//! visible books, ordered by an override-aware effective book count. The
//! match runs the *folded* pattern against the diacritic-folded name key; a
//! row the boot backfill has not reached (`name_norm` NULL) is matched with
//! the *raw* pattern against its raw name instead, which is exactly the
//! pre-fold behaviour — a folded pattern against a raw accented name would
//! miss a query typed with its accents. Visibility is the rule
//! `browse::list_authors` uses — membership in that same effective set — so
//! the palette cannot offer an author the Authors index rejects.

use std::sync::OnceLock;

use omnibus_shared::text_fold::fold_for_match;
use omnibus_shared::PaletteAuthorHit;
use sqlx::{Row, SqlitePool};

use crate::helpers::{library_paths_json, visible_book_sql};
// The membership fragment expands the precedence macro at this site, so it
// must be in scope here too.
use crate::metadata_overrides::sql::{
    effective_authors_sql, overrides_win_sql, safe_overrides_sql,
};

use super::PaletteError;

/// Authors-arm palette query, bound `?1 = library_paths JSON array`,
/// `?2 = folded like_pattern`, `?3 = limit`, `?4 = raw like_pattern` (the
/// NULL-key fallback).
///
/// Visibility scoping ([`visible_book_sql`]) is applied before aggregation so
/// book_count stays library-correct (covered by
/// `search_palette_scoped_to_library` and
/// `search_palette_taxonomy_counts_scoped_per_library`). The join plan is
/// locked in by `search_palette_taxonomy_query_plans_use_indexes`.
///
/// Both the count and the visibility gate read the shared effective
/// membership (`effective_authors_sql!`) — the relation the Authors index and
/// smart-shelf author rules read — so an author whose books were all
/// re-credited through the edit form drops out rather than advertising a
/// count its `/author/:id` page no longer shows.
pub(super) fn search_authors_sql() -> &'static str {
    static SQL: OnceLock<String> = OnceLock::new();
    SQL.get_or_init(|| {
        format!(
            r"
        WITH {effective},
        counts AS (
          SELECT author_id, COUNT(*) AS book_count
            FROM effective
           GROUP BY author_id
        )
        SELECT a.id, a.name,
          c.book_count AS book_count,
          -- The lead title comes off the effective set too: reading it from
          -- `books_authors_link` is what let a dead row advertise `incl. Six
          -- of Crows` for a book it no longer credits.
          (SELECT COALESCE(json_extract({overrides}, '$.title'), b3.title)
             FROM effective e3
             JOIN books b3 ON b3.id = e3.book_id
             LEFT JOIN metadata_overrides mo3 ON mo3.book_uuid = b3.uuid
            WHERE e3.author_id = a.id
            ORDER BY b3.sort, b3.id LIMIT 1) AS lead_book_title
        FROM authors a
        JOIN counts c ON c.author_id = a.id
        WHERE (a.name_norm LIKE ?2 ESCAPE '\'
               OR (a.name_norm IS NULL AND a.name LIKE ?4 ESCAPE '\'))
        ORDER BY book_count DESC, a.name
        LIMIT ?3
        ",
            effective = visible_effective_authors(),
            overrides = safe_overrides_sql!("mo3"),
        )
    })
}

/// The `effective(author_id, book_id)` CTE both author queries share: the
/// shared membership narrowed to the books visible under `?1`, materialized
/// so the count and the lead-title lookup scan it once.
fn visible_effective_authors() -> String {
    let vis = visible_book_sql("b", "l", "?1");
    format!(
        r"effective AS MATERIALIZED (
          SELECT ea.author_id, ea.book_id
            FROM ({membership}) ea
            JOIN books b ON b.id = ea.book_id
            JOIN scan_roots l ON l.id = b.library_id
           WHERE {vis}
        )",
        membership = effective_authors_sql!()
    )
}

/// Run the authors arm of the palette for `like_pattern` (already escaped)
/// scoped to `library_path`, capped to `limit`.
pub async fn search_authors(
    pool: &SqlitePool,
    library_path: &str,
    like_pattern: &str,
    limit: i32,
) -> Result<Vec<PaletteAuthorHit>, PaletteError> {
    search_authors_for_paths(pool, &[library_path], like_pattern, limit).await
}

/// Run the authors arm across every configured library path.
pub async fn search_authors_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    like_pattern: &str,
    limit: i32,
) -> Result<Vec<PaletteAuthorHit>, PaletteError> {
    if library_paths.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(search_authors_sql())
        .bind(library_paths_json(library_paths))
        .bind(fold_for_match(like_pattern))
        .bind(limit)
        .bind(like_pattern)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .iter()
        .map(|r| PaletteAuthorHit {
            id: r.get("id"),
            name: r.get("name"),
            book_count: u32::try_from(r.get::<i32, _>("book_count")).unwrap_or(0),
            lead_book_title: r.get("lead_book_title"),
        })
        .collect())
}

/// Count visible authors matching `like_pattern` in `library_path` — the
/// uncapped total behind the palette's 5-hit author cap. "Visible" mirrors
/// [`search_authors`]: at least one effective credit on a visible book.
pub async fn count_authors(
    pool: &SqlitePool,
    library_path: &str,
    like_pattern: &str,
) -> Result<i64, PaletteError> {
    count_authors_for_paths(pool, &[library_path], like_pattern).await
}

/// Count visible matching authors across every configured library path.
pub async fn count_authors_for_paths(
    pool: &SqlitePool,
    library_paths: &[&str],
    like_pattern: &str,
) -> Result<i64, PaletteError> {
    if library_paths.is_empty() {
        return Ok(0);
    }
    Ok(sqlx::query_scalar::<_, i64>(&format!(
        r"
        WITH {effective}
        SELECT COUNT(*) FROM authors a
        WHERE (a.name_norm LIKE ?2 ESCAPE '\'
               OR (a.name_norm IS NULL AND a.name LIKE ?3 ESCAPE '\'))
          AND EXISTS (SELECT 1 FROM effective e WHERE e.author_id = a.id)
        ",
        effective = visible_effective_authors()
    ))
    .bind(library_paths_json(library_paths))
    .bind(fold_for_match(like_pattern))
    .bind(like_pattern)
    .fetch_one(pool)
    .await?)
}
