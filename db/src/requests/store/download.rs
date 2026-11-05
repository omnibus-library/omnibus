//! What the download poller writes: tagging a pick before the client is called, moving a
//! request on its way, recording progress, stopping it, and working through the downloads
//! to take out of the client. Every write that follows a verdict names the pick it was read
//! for, so a verdict about an old pick never lands on a new one.

use sqlx::SqlitePool;

use super::{row_to_request, RequestError, RequestRow, COLUMNS, DOWNLOADING, NOW};

/// The Unix time now, as the writes below take it.
pub fn unix_now() -> i64 {
    crate::auth::now_unix()
}

/// Hand every cancelled download whose Undo grace has ended to the removal list. One
/// statement, so an Undo racing the end of the grace either wins (the request is restored and
/// nothing is removed) or loses (it answers `WrongState`), never both. A cancel is held back
/// while an earlier download is still being removed.
pub async fn claim_due_cancels(pool: &SqlitePool, now: i64) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests
         SET remove_tag = COALESCE(client_tag, remove_tag),
             remove_since = CASE WHEN client_tag IS NULL THEN remove_since ELSE ?1 END,
             client_tag = NULL, cancel_at = NULL
         WHERE cancel_at IS NOT NULL AND cancel_at <= ?1
           AND (remove_tag IS NULL OR client_tag IS NULL)",
    )
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Requests with a download to take out of the client.
pub async fn pending_removals(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE remove_tag IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Note that the client has shown the download `tag` of request `id`, so its absence later
/// means it is gone rather than not yet fetched.
pub async fn mark_removal_seen(pool: &SqlitePool, id: i64, tag: &str) -> Result<(), RequestError> {
    sqlx::query("UPDATE book_requests SET remove_since = NULL WHERE id = ? AND remove_tag = ?")
        .bind(id)
        .bind(tag)
        .execute(pool)
        .await?;
    Ok(())
}

/// Forget the removal of `tag`: the client no longer has it.
pub async fn finish_removal(pool: &SqlitePool, id: i64, tag: &str) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET remove_tag = NULL, remove_since = NULL
         WHERE id = ? AND remove_tag = ?",
    )
    .bind(id)
    .bind(tag)
    .execute(pool)
    .await?;
    Ok(())
}

/// Picked requests no download has been started for.
pub async fn awaiting_add(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests
         WHERE state = 'chosen' AND chosen_result_id IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Mark request `id`'s picked version with its own tag, `omnibus-<request>-<version>`, then
/// return `(tag, link)` for the client. The tag is written before the client is called, so a
/// cancel that lands meanwhile still finds the download to remove; it is unique to the pick,
/// so a download left from an earlier pick is never mistaken for this one. `None` once the
/// request is no longer waiting to be added. The link can carry an indexer key: hand it to the
/// client and nowhere else.
pub async fn begin_download(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<(String, String)>, RequestError> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "UPDATE book_requests SET client_tag = 'omnibus-' || id || '-' || chosen_result_id
         WHERE id = ? AND state = 'chosen' AND chosen_result_id IS NOT NULL
         RETURNING client_tag, chosen_result_id",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some((tag, result)) = row else {
        return Ok(None);
    };
    let link: Option<String> =
        sqlx::query_scalar("SELECT download_url FROM book_request_results WHERE id = ?")
            .bind(result)
            .fetch_optional(pool)
            .await?;
    Ok(link.map(|link| (tag, link)))
}

/// Move a picked request to `on_its_way` once its download is with the client.
pub async fn mark_on_its_way(pool: &SqlitePool, id: i64, now: i64) -> Result<(), RequestError> {
    sqlx::query(&format!(
        "UPDATE book_requests SET state = 'on_its_way', moved_at = ?, updated_at = {NOW}
         WHERE id = ? AND state = 'chosen'"
    ))
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Requests on their way whose download has not finished.
pub async fn downloading(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE {DOWNLOADING} AND client_tag IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Record how far request `id`'s download of pick `chosen` is, and when it last gained bytes.
pub async fn record_progress(
    pool: &SqlitePool,
    id: i64,
    chosen: Option<i64>,
    progress: f64,
    moved_at: i64,
) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET progress = ?, moved_at = ?
         WHERE id = ? AND state = 'on_its_way' AND chosen_result_id = ?",
    )
    .bind(progress)
    .bind(moved_at)
    .bind(id)
    .bind(chosen)
    .execute(pool)
    .await?;
    Ok(())
}

/// End a request's pick `chosen`, picked or downloading, as `stopped_moving`. `detail` is
/// for admins.
pub async fn mark_stopped(
    pool: &SqlitePool,
    id: i64,
    chosen: Option<i64>,
    detail: &str,
) -> Result<(), RequestError> {
    sqlx::query(&format!(
        "UPDATE book_requests
         SET state = 'stuck', stuck_reason = 'stopped_moving', stuck_detail = ?, updated_at = {NOW}
         WHERE id = ? AND state IN ('chosen', 'on_its_way') AND chosen_result_id = ?"
    ))
    .bind(detail)
    .bind(id)
    .bind(chosen)
    .execute(pool)
    .await?;
    Ok(())
}

/// Whether the poller has anything to watch: a pick to add, a download to follow or a
/// download to take out.
pub async fn has_download_work(pool: &SqlitePool) -> Result<bool, RequestError> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT EXISTS (SELECT 1 FROM book_requests
         WHERE state = 'chosen' OR cancel_at IS NOT NULL OR remove_tag IS NOT NULL OR {DOWNLOADING})"
    ))
    .fetch_one(pool)
    .await?)
}
