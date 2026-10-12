//! The window's single most-X figures — longest and shortest book, biggest
//! reading day, longest sit, fastest read. Every input is already persisted;
//! each figure is one ranked query over a table the rest of `db::stats`
//! already aggregates.
//!
//! The two day-shaped figures — biggest day, fastest read — cut their days on
//! `offset_minutes` via `calendar`, because they render beside the heatmap and
//! the pages tile that do the same.

use omnibus_shared::{BookSuperlative, DayActivity, Superlatives, FASTEST_READ_MIN_SECS};
use sqlx::{Row, SqlitePool};

use crate::metadata_overrides::sql::{
    effective_text_sql, effective_value_sql, override_join_sql, override_present_sql,
    overrides_win_sql,
};

use super::compute::{SESSION_ROWS, USER_SESSION_ROWS};
use super::{calendar, pages, sessionize, StatsError};

/// The joins every book-naming superlative shares: position-0 creator,
/// left-joined so a book with no author link still wins its category, plus
/// the override layer [`BOOK_COLUMNS`] reads through.
const AUTHOR_JOIN: &str = concat!(
    "LEFT JOIN books_authors_link bal ON bal.book = b.id AND bal.position = 0 \
     LEFT JOIN authors a ON a.id = bal.author",
    override_join_sql!()
);

/// The three columns every book-naming superlative selects, minus its own
/// `value`. Both text columns read the **effective** value (the override where the
/// reader set one), so a standout names a book as every other surface does;
/// `COALESCE` on the title mirrors `compute::finished_books`.
const BOOK_COLUMNS: &str = concat!(
    "b.uuid AS uuid, COALESCE(",
    effective_value_sql!("$.title"; "b.title"),
    ", 'Untitled') COLLATE NOCASE AS title, ",
    effective_text_sql!("$.creators[0].name"; "a.name"),
    " AS author"
);

/// Every superlative for one user's window. Runs the ranked queries and
/// applies the one cross-figure rule: a "shortest book" that says nothing
/// next to the longest is dropped rather than rendered (see
/// [`drop_degenerate_shortest`]).
pub(super) async fn superlatives(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
    offset_minutes: i64,
) -> Result<Superlatives, StatsError> {
    let longest_book = extreme_book(pool, user_id, start, Extreme::Longest).await?;
    let shortest_book = extreme_book(pool, user_id, start, Extreme::Shortest).await?;
    let biggest_day = biggest_day(pool, user_id, start, offset_minutes).await?;
    let longest_sit = longest_sit(pool, user_id, start).await?;
    let fastest_read = fastest_read(pool, user_id, start, offset_minutes).await?;

    Ok(Superlatives {
        shortest_book: drop_degenerate_shortest(longest_book.as_ref(), shortest_book),
        longest_book,
        biggest_day,
        longest_sit,
        fastest_read,
    })
}

/// Which end of the length ordering a query wants.
#[derive(Clone, Copy)]
enum Extreme {
    Longest,
    Shortest,
}

impl Extreme {
    fn direction(self) -> &'static str {
        match self {
            Extreme::Longest => "DESC",
            Extreme::Shortest => "ASC",
        }
    }
}

/// The longest or shortest book finished in the window, measured by the shared
/// length ladder. Books the ladder can't measure are excluded rather than sorted
/// as zero, and `> 0` rather than `IS NOT NULL` enforces that (an image-only EPUB
/// yields a real `0`). Ties break on the *rendered* title, so an untitled book
/// sorts where the reader sees it.
async fn extreme_book(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
    extreme: Extreme,
) -> Result<Option<BookSuperlative>, StatsError> {
    let sql = format!(
        "SELECT {BOOK_COLUMNS}, p.pages AS value
         FROM ({}) fin
         JOIN books b ON b.uuid = fin.uuid
         JOIN ({}) p ON p.uuid = fin.uuid
         {AUTHOR_JOIN}
         WHERE p.pages > 0
         ORDER BY p.pages {}, title ASC
         LIMIT 1",
        pages::finished_in_window(),
        pages::book_pages_source(),
        extreme.direction()
    );
    let row = sqlx::query(&sql)
        .bind(user_id)
        .bind(user_id)
        .bind(start)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(book_superlative))
}

/// Suppress a "shortest book" that only restates the longest one: the *same* book
/// (the window finished exactly one measurable book) or the same page count. Both
/// render as a range the window doesn't have.
fn drop_degenerate_shortest(
    longest: Option<&BookSuperlative>,
    shortest: Option<BookSuperlative>,
) -> Option<BookSuperlative> {
    let (long, short) = (longest?, shortest?);
    (long.book_uuid != short.book_uuid && long.value != short.value).then_some(short)
}

/// The single busiest day in the window, reading and listening together: a `MAX`
/// over the same per-day rollup `compute::heatmap` builds, on the same
/// [`calendar::local_day`] buckets. Ties break to the earliest day. A day under
/// [`sessionize::MIN_SITTING_SECS`] is no day at all (the floor [`longest_sit`]
/// uses), or a 45-second glance would headline "Biggest day — 0 m".
async fn biggest_day(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
    offset_minutes: i64,
) -> Result<Option<DayActivity>, StatsError> {
    let sql = format!(
        "SELECT {} AS day, SUM(secs) AS seconds
         FROM ({SESSION_ROWS})
         GROUP BY day HAVING seconds >= {}
         ORDER BY seconds DESC, day ASC LIMIT 1",
        calendar::local_day("started_at", offset_minutes),
        sessionize::MIN_SITTING_SECS
    );
    let row = sqlx::query(&sql)
        .bind(user_id)
        .bind(start)
        .bind(user_id)
        .bind(start)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| DayActivity {
        day: r.get("day"),
        seconds: r.get("seconds"),
    }))
}

/// The longest single sitting in the window: the user-wide twin of
/// `book::book_insights`'s `longest_seconds`, over the same stitched checkpoint rows.
/// Glances under [`sessionize::MIN_SITTING_SECS`] are excluded, as everywhere a
/// sitting is counted. Ties break to the earliest sitting.
async fn longest_sit(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
) -> Result<Option<BookSuperlative>, StatsError> {
    let sql = format!(
        "SELECT {BOOK_COLUMNS}, s.secs AS value
         FROM ({}) s
         JOIN books b ON b.uuid = s.book_uuid
         {AUTHOR_JOIN}
         WHERE s.secs >= {}
         ORDER BY s.secs DESC, s.started_at ASC
         LIMIT 1",
        sessionize::stitched(SESSION_ROWS),
        sessionize::MIN_SITTING_SECS
    );
    let row = sqlx::query(&sql)
        .bind(user_id)
        .bind(start)
        .bind(user_id)
        .bind(start)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(book_superlative))
}

/// The book finished in the window in the fewest days from its **first recorded
/// session**, in whole days on the reader's calendar (a same-day read is one). Uses
/// lifetime sessions, not the window's, and the earliest in-window completion. A
/// [`FASTEST_READ_MIN_SECS`] floor narrows, but doesn't remove, the stray-checkpoint
/// lie, so surfaces present it as a lower bound. Ties break on the rendered title.
async fn fastest_read(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
    offset_minutes: i64,
) -> Result<Option<BookSuperlative>, StatsError> {
    // Both ends use `local_day_number`; the shared shift usually cancels, but not when it
    // carries one end across a midnight. `s.first_at <= f.finished_at` drops a book whose
    // sessions all post-date its completion rather than reporting a negative span.
    let finished_day = calendar::local_day_number("f.finished_at", offset_minutes);
    let first_day = calendar::local_day_number("s.first_at", offset_minutes);
    let sql = format!(
        "SELECT {BOOK_COLUMNS},
                MAX(1, {finished_day} - {first_day}) AS value
         FROM (
             SELECT book_uuid, MIN(finished_at) AS finished_at
             FROM ({}) WHERE finished_at >= ? GROUP BY book_uuid
         ) f
         JOIN books b ON b.uuid = f.book_uuid
         JOIN (
             SELECT book_uuid, MIN(started_at) AS first_at, SUM(secs) AS secs
             FROM ({USER_SESSION_ROWS}) GROUP BY book_uuid
         ) s ON s.book_uuid = f.book_uuid
         {AUTHOR_JOIN}
         WHERE s.secs >= {FASTEST_READ_MIN_SECS} AND s.first_at <= f.finished_at
         ORDER BY value ASC, title ASC
         LIMIT 1",
        super::FINISHED_EVENTS
    );
    let row = sqlx::query(&sql)
        .bind(user_id)
        .bind(user_id)
        .bind(start)
        .bind(user_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(book_superlative))
}

/// Read the four columns every book-naming superlative selects off a row.
fn book_superlative(row: &sqlx::sqlite::SqliteRow) -> BookSuperlative {
    BookSuperlative {
        book_uuid: row.get("uuid"),
        title: row.get("title"),
        author: row.get("author"),
        value: row.get("value"),
    }
}

#[cfg(test)]
mod tests;
