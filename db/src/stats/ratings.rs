//! Star-rating aggregation for the stats page's Avg rating tile and its
//! drill-in: the window mean, the previous window's mean, the trailing-12-month
//! mean trend, and the half-star distribution. Every function here shares one
//! window key, [`avg_stars`]'s — they must not diverge on it.

use omnibus_shared::{RatingBucket, TrendPoint};
use sqlx::{Row, SqlitePool};

use super::{calendar, StatsError};

/// A rating on a book that still exists, scoped to one user — the same
/// liveness rule `compute::live_finished_events` applies to completions.
/// Bind order is `user_id`. A review with no stars is no rating.
///
/// A rating the book page cannot render must not move the mean.
pub(super) const LIVE_RATINGS: &str = "\
    SELECT r.user_id AS user_id, r.half_stars AS half_stars, r.rated_at AS rated_at \
    FROM reviews r \
    JOIN books b ON b.uuid = r.book_uuid \
    WHERE r.user_id = ? AND r.half_stars IS NOT NULL";

/// Mean star rating over books the user rated within the window, in stars
/// (`half_stars` is 1..=10, so the SQL mean halves it); `None` when nothing was
/// rated. Live books only, per [`LIVE_RATINGS`]. **The window key, here and in every
/// sibling, is `reviews.rated_at`**: when the reader last changed the stars, not when
/// they finished the book or edited the review text, so re-rating an old book pulls
/// it into the current window and rewording its review does not.
pub(super) async fn avg_stars(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
) -> Result<Option<f64>, StatsError> {
    // Keyed on the rating, not the completion event, which would drop ratings on books
    // never marked finished (abandoned and rated): a worse distortion.
    let sql = format!("SELECT AVG(half_stars) / 2.0 FROM ({LIVE_RATINGS}) WHERE rated_at >= ?");
    Ok(sqlx::query_scalar(&sql)
        .bind(user_id)
        .bind(start)
        .fetch_one(pool)
        .await?)
}

/// [`avg_stars`], upper-bounded — `rated_at` in `[start, end)`.
pub(super) async fn avg_stars_bounded(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
    end: i64,
) -> Result<Option<f64>, StatsError> {
    let sql = format!(
        "SELECT AVG(half_stars) / 2.0 FROM ({LIVE_RATINGS}) \
         WHERE rated_at >= ? AND rated_at < ?"
    );
    Ok(sqlx::query_scalar(&sql)
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch_one(pool)
        .await?)
}

/// How many books sit in each half-star bucket over the window: the shape
/// [`avg_stars`] flattens away. All ten buckets come back, zeros included, since
/// missing bars read as a different distribution. Scoped identically to
/// [`avg_stars`] (same `rated_at` window and [`LIVE_RATINGS`] filter), so the
/// bucket counts sum to exactly the set the mean is computed over.
pub(super) async fn rating_histogram(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
) -> Result<Vec<RatingBucket>, StatsError> {
    let sql = format!(
        "WITH RECURSIVE buckets(half_stars) AS (
             SELECT 1
             UNION ALL
             SELECT half_stars + 1 FROM buckets WHERE half_stars < 10
         )
         SELECT buckets.half_stars AS half_stars, COUNT(r.half_stars) AS books
         FROM buckets
         LEFT JOIN ({LIVE_RATINGS}) r
                ON r.half_stars = buckets.half_stars AND r.rated_at >= ?
         GROUP BY buckets.half_stars
         ORDER BY buckets.half_stars"
    );
    let rows = sqlx::query(&sql)
        .bind(user_id)
        .bind(start)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|r| RatingBucket {
            half_stars: r.get("half_stars"),
            books: r.get("books"),
        })
        .collect())
}

/// Mean star rating per calendar month over the trailing 12 months (oldest first,
/// ending at the current month): the Avg rating tile's drill-in trend. A month with
/// no ratings comes back as `0.0`. Spine ([`calendar::month_spine`]) and join
/// (`rated_at`'s local month) are cut on the reader's calendar, as the chart
/// builder's `AvgRating` arm does.
pub(super) async fn rating_monthly(
    pool: &SqlitePool,
    user_id: i64,
    offset_minutes: i64,
) -> Result<Vec<TrendPoint>, StatsError> {
    let sql = format!(
        "WITH RECURSIVE {}
         SELECT months.month AS month, AVG(ur.half_stars) / 2.0 AS avg_stars
         FROM months
         LEFT JOIN ({LIVE_RATINGS}) ur
                ON {} = months.month
         GROUP BY months.month
         ORDER BY months.month",
        calendar::month_spine(offset_minutes),
        calendar::local_month("ur.rated_at", offset_minutes)
    );
    let rows = sqlx::query(&sql).bind(user_id).fetch_all(pool).await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let month: String = r.get("month");
            let avg_stars: Option<f64> = r.get("avg_stars");
            TrendPoint {
                label: month,
                value: avg_stars.unwrap_or(0.0),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests;
