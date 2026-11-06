//! The cover a finished download brought, held as a candidate on its request until the
//! reader takes or keeps it. The import records the downloaded book's uuid before the
//! merge folds that book away; its cover file outlives the merge, so nothing is copied.

use sqlx::SqlitePool;

use super::store::RequestError;

/// Offer the cover of `book_uuid`, the download as it was scanned in, on request `id`.
pub async fn record_candidate(
    pool: &SqlitePool,
    id: i64,
    book_uuid: &str,
) -> Result<(), RequestError> {
    sqlx::query("UPDATE book_requests SET cover_candidate = ? WHERE id = ?")
        .bind(book_uuid)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
