//! Per-reader overlays on the browse surfaces: how far one reader is through
//! each author ([`author_reading`]) and where they are in each of a set of
//! books ([`book_reading`]). Kept apart from the library-wide rows in the
//! parent module, which every reader shares and other surfaces reuse.
//!
//! A book's status is the stored one; with none stored, a saved position
//! counts as reading, the rule the Continue rail already applies.

use omnibus_shared::{AuthorReading, BookReading, EbookMetadata, ReadStatus};
use sqlx::{Row, SqlitePool};

use crate::metadata_overrides::sql::{effective_authors_sql, overrides_win_sql};

use super::{placeholders, visible, BrowseError};

/// The latest position per book for the reader bound as `?1`, by client
/// event time. SQLite takes the bare columns from the row holding the MAX.
const LATEST_POSITION_CTE: &str = "pos AS (
    SELECT rp.book_uuid,
           rp.progress_percent AS percent,
           rp.format,
           rp.book_file_id,
           MAX(COALESCE(rp.client_updated_at, rp.updated_at)) AS at
      FROM reading_progress rp
     WHERE rp.user_id = ?1
     GROUP BY rp.book_uuid
)";

/// Finished/reading counts and the latest read time for every author with a
/// book the reader `user_id` has opened or marked, over the same visible,
/// override-aware membership [`super::list_authors`] counts.
pub async fn author_reading(
    pool: &SqlitePool,
    user_id: i64,
    library_paths: &[&str],
) -> Result<Vec<AuthorReading>, BrowseError> {
    let sql = author_reading_sql(library_paths.len());
    let mut q = sqlx::query(&sql).bind(user_id);
    for path in library_paths {
        q = q.bind(*path);
    }
    let rows = q.fetch_all(pool).await?;
    Ok(rows
        .iter()
        .map(|r| AuthorReading {
            author_id: r.get("author_id"),
            finished: count(r.get("finished")),
            reading: count(r.get("reading")),
            last_read_at: r.get("last_read_at"),
        })
        .collect())
}

/// Query text for [`author_reading`]: `?1` is the reader, `?2..` the paths.
fn author_reading_sql(n: usize) -> String {
    // Numbered throughout: sqlx counts bare `?`s apart from `?NNN`, so a bare
    // path slot would take the reader's `?1`. `placeholders` covers `n == 0`.
    let ph = if n == 0 {
        placeholders(0)
    } else {
        (2..2 + n)
            .map(|i| format!("(?{i})"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let vis = visible("b", "l");
    format!(
        r"
        WITH {LATEST_POSITION_CTE},
        lib_paths(p) AS (VALUES {ph}),
        effective AS (
            SELECT e.author_id, e.book_id
              FROM ({effective}) e
              JOIN books b ON b.id = e.book_id
              JOIN scan_roots l ON l.id = b.library_id
             WHERE {vis}
        ),
        state AS (
            SELECT b.id AS book_id,
                   COALESCE(rs.status, 'reading') AS status,
                   MAX(COALESCE(pos.at, 0),
                       CASE WHEN rs.status IN ('reading', 'finished')
                            THEN rs.updated_at ELSE 0 END) AS at
              FROM books b
              LEFT JOIN book_read_status rs
                     ON rs.user_id = ?1 AND rs.book_uuid = b.uuid
              LEFT JOIN pos ON pos.book_uuid = b.uuid
             WHERE rs.book_uuid IS NOT NULL OR pos.book_uuid IS NOT NULL
        )
        SELECT e.author_id,
               SUM(s.status = 'finished') AS finished,
               SUM(s.status = 'reading') AS reading,
               MAX(CASE WHEN s.status != 'unread' THEN NULLIF(s.at, 0) END) AS last_read_at
          FROM effective e
          JOIN state s ON s.book_id = e.book_id
         GROUP BY e.author_id
        ",
        effective = effective_authors_sql!()
    )
}

/// The reader `user_id`'s state on each of `book_uuids` they have opened or
/// marked; the rest are left out, which reads as unread with no position.
pub async fn book_reading(
    pool: &SqlitePool,
    user_id: i64,
    book_uuids: &[String],
) -> Result<Vec<BookReading>, BrowseError> {
    if book_uuids.is_empty() {
        return Ok(Vec::new());
    }
    let wanted = serde_json::to_string(book_uuids).unwrap_or_else(|_| "[]".into());
    let sql = format!(
        "WITH {LATEST_POSITION_CTE}
         SELECT w.value AS book_uuid, rs.status, rs.updated_at AS status_at,
                pos.percent, pos.format, pos.book_file_id, pos.at AS pos_at
           FROM json_each(?2) w
           LEFT JOIN book_read_status rs
                  ON rs.user_id = ?1 AND rs.book_uuid = w.value
           LEFT JOIN pos ON pos.book_uuid = w.value
          WHERE rs.book_uuid IS NOT NULL OR pos.book_uuid IS NOT NULL"
    );
    let rows = sqlx::query(&sql)
        .bind(user_id)
        .bind(wanted)
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(map_book_reading).collect())
}

/// The uuids [`book_reading`] takes, from a list of books.
pub fn book_uuids(books: &[EbookMetadata]) -> Vec<String> {
    books
        .iter()
        .filter_map(|b| b.unique_identifier.clone())
        .collect()
}

/// One [`book_reading`] row to the wire type.
fn map_book_reading(r: &sqlx::sqlite::SqliteRow) -> BookReading {
    let status = r
        .get::<Option<String>, _>("status")
        .map_or(ReadStatus::Reading, |s| ReadStatus::from_db(&s));
    let status_at = (status != ReadStatus::Unread)
        .then(|| r.get::<Option<i64>, _>("status_at"))
        .flatten();
    let pos_at: Option<i64> = r.get("pos_at");
    BookReading {
        book_uuid: r.get("book_uuid"),
        status,
        percent: r.get("percent"),
        format: r
            .get::<Option<String>, _>("format")
            .map(|f| crate::progress::parse_format(&f)),
        book_file_id: r.get("book_file_id"),
        last_read_at: pos_at.max(status_at),
    }
}

/// A SQL `SUM` (an `i64`, never negative here) as a count.
fn count(n: i64) -> usize {
    usize::try_from(n).unwrap_or(0)
}

#[cfg(test)]
mod tests;
