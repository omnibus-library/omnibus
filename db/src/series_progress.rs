//! Which series a reader keeps off their home page's series in progress: the
//! per-reader hide, set and cleared from the series page and its row. Called by
//! the `/api/series` handlers. A hide names the series, never a book, so a
//! merge or reindex has nothing to settle.

use sqlx::SqlitePool;

/// Failure space for the series-in-progress reads and writes.
#[derive(Debug, thiserror::Error)]
pub enum SeriesProgressError {
    #[error("series not found")]
    SeriesNotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Hide `series_id` from the reader's home page; hiding it again is a no-op.
pub async fn hide(
    pool: &SqlitePool,
    user_id: i64,
    series_id: i64,
) -> Result<(), SeriesProgressError> {
    // One statement, so a series deleted mid-call can't be hidden after the check.
    let landed = sqlx::query(
        "INSERT INTO series_hides (user_id, series_id)
         SELECT ?, id FROM series WHERE id = ?
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(series_id)
    .execute(pool)
    .await?
    .rows_affected();
    if landed == 0 {
        require_series(pool, series_id).await?;
    }
    Ok(())
}

/// Bring `series_id` back to the reader's home page; unhiding a shown series is a no-op.
pub async fn unhide(
    pool: &SqlitePool,
    user_id: i64,
    series_id: i64,
) -> Result<(), SeriesProgressError> {
    let removed = sqlx::query("DELETE FROM series_hides WHERE user_id = ? AND series_id = ?")
        .bind(user_id)
        .bind(series_id)
        .execute(pool)
        .await?
        .rows_affected();
    if removed == 0 {
        require_series(pool, series_id).await?;
    }
    Ok(())
}

/// Whether the reader hid `series_id` from their home page.
pub async fn is_hidden(
    pool: &SqlitePool,
    user_id: i64,
    series_id: i64,
) -> Result<bool, SeriesProgressError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM series_hides WHERE user_id = ? AND series_id = ?)",
    )
    .bind(user_id)
    .bind(series_id)
    .fetch_one(pool)
    .await?)
}

/// A zero-row write is "already so" for a real series and an error for an unknown one.
async fn require_series(pool: &SqlitePool, series_id: i64) -> Result<(), SeriesProgressError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM series WHERE id = ?)")
        .bind(series_id)
        .fetch_one(pool)
        .await?;
    exists
        .then_some(())
        .ok_or(SeriesProgressError::SeriesNotFound)
}

#[cfg(test)]
mod tests;
