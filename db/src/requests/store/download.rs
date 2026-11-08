//! What the download poller writes: moving a pick on its way once the client has it, recording progress, stopping it, working through the downloads
//! to take out of the client, and ending the import of a finished one. Every write that follows a verdict names the pick it was read
//! for, so a verdict about an old pick never lands on a new one.

use omnibus_shared::StuckReason;
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
         SET remove_hash = CASE WHEN client_adopted = 0
                                THEN COALESCE(client_hash, remove_hash) ELSE remove_hash END,
             remove_since = CASE WHEN client_hash IS NULL OR client_adopted = 1
                                 THEN remove_since ELSE ?1 END,
             client_hash = NULL, client_adopted = 0, cancel_at = NULL
         WHERE cancel_at IS NOT NULL AND cancel_at <= ?1
           AND (remove_hash IS NULL OR client_hash IS NULL)",
    )
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Requests with a download to take out of the client.
pub async fn pending_removals(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE remove_hash IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Note that the client has shown the download `hash` of request `id`, so its absence later
/// means it is gone rather than not yet fetched.
pub async fn mark_removal_seen(pool: &SqlitePool, id: i64, hash: &str) -> Result<(), RequestError> {
    sqlx::query("UPDATE book_requests SET remove_since = NULL WHERE id = ? AND remove_hash = ?")
        .bind(id)
        .bind(hash)
        .execute(pool)
        .await?;
    Ok(())
}

/// Forget the removal of `hash`: the client no longer has it.
pub async fn finish_removal(pool: &SqlitePool, id: i64, hash: &str) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET remove_hash = NULL, remove_since = NULL
         WHERE id = ? AND remove_hash = ?",
    )
    .bind(id)
    .bind(hash)
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

/// The link of request `id`'s picked version, while it waits to be added; `None` once it no
/// longer does. The link can carry an indexer key: hand it to the client and nowhere else.
pub async fn pick_link(pool: &SqlitePool, id: i64) -> Result<Option<String>, RequestError> {
    Ok(sqlx::query_scalar(
        "SELECT r.download_url FROM book_requests q
         JOIN book_request_results r ON r.id = q.chosen_result_id
         WHERE q.id = ? AND q.state = 'chosen'",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// Record, before the client is given the release, that request `id` is adding the torrent
/// with info hash `hash`, so a cancel or a crash from here on still knows Omnibus owns it. A
/// removal of the same torrent that was waiting is called off. `false` when the request is no
/// longer waiting to be added.
pub async fn claim_hash(pool: &SqlitePool, id: i64, hash: &str) -> Result<bool, RequestError> {
    let claimed = sqlx::query(&format!(
        "UPDATE book_requests
         SET client_hash = ?1, client_adopted = 0,
             remove_since = CASE WHEN remove_hash = ?1 THEN NULL ELSE remove_since END,
             remove_hash = CASE WHEN remove_hash = ?1 THEN NULL ELSE remove_hash END,
             updated_at = {NOW}
         WHERE id = ?2 AND state = 'chosen'"
    ))
    .bind(hash)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(claimed == 1)
}

/// Give back the claim on `hash` that the client refused to honour.
pub async fn release_claim(pool: &SqlitePool, id: i64, hash: &str) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET client_hash = NULL
         WHERE id = ? AND client_hash = ? AND state = 'chosen'",
    )
    .bind(id)
    .bind(hash)
    .execute(pool)
    .await?;
    Ok(())
}

/// Move a picked request to `on_its_way` once its download, with info hash `hash`, is with the
/// client; `adopted` is whether the client already held it. A removal of the same torrent that
/// was waiting is called off. `false` when the request is no longer waiting to be added, such
/// as after a cancel, which then removes what it owns itself.
pub async fn mark_on_its_way(
    pool: &SqlitePool,
    id: i64,
    hash: &str,
    adopted: bool,
    now: i64,
) -> Result<bool, RequestError> {
    let moved = sqlx::query(&format!(
        "UPDATE book_requests
         SET state = 'on_its_way', client_hash = ?1, client_adopted = ?2, moved_at = ?3,
             expected_done_at = NULL,
             remove_since = CASE WHEN remove_hash = ?1 THEN NULL ELSE remove_since END,
             remove_hash = CASE WHEN remove_hash = ?1 THEN NULL ELSE remove_hash END,
             updated_at = {NOW}
         WHERE id = ?4 AND state = 'chosen'"
    ))
    .bind(hash)
    .bind(adopted)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(moved == 1)
}

/// Whether a request other than `except` still holds the torrent `hash` as a download in
/// progress, so removing it would take the download from that request.
pub async fn hash_in_use(pool: &SqlitePool, hash: &str, except: i64) -> Result<bool, RequestError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM book_requests
         WHERE client_hash = ? AND id != ? AND state IN ('choose', 'chosen', 'on_its_way', 'stuck'))",
    )
    .bind(hash)
    .bind(except)
    .fetch_one(pool)
    .await?)
}

/// Requests whose download an earlier version tagged and has not yet been found by hash.
pub async fn with_legacy_tag(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE legacy_tag IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Settle request `id`'s `legacy_tag`: the download it names has info hash `hash` and is one
/// Omnibus added, or, with `None`, the client no longer has it.
pub async fn resolve_legacy_tag(
    pool: &SqlitePool,
    id: i64,
    tag: &str,
    hash: Option<&str>,
) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET client_hash = ?, client_adopted = 0, legacy_tag = NULL
         WHERE id = ? AND legacy_tag = ?",
    )
    .bind(hash)
    .bind(id)
    .bind(tag)
    .execute(pool)
    .await?;
    Ok(())
}

/// Requests on their way whose download has not finished.
pub async fn downloading(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE {DOWNLOADING} AND client_hash IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Requests whose download is complete and waiting to be added to the library.
pub async fn awaiting_import(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests
         WHERE state = 'on_its_way' AND progress >= 1 AND client_hash IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Note where request `id`'s pick `chosen` was filed, `key` being its library-relative path,
/// so a retried import resumes there instead of filing a second copy.
pub async fn set_import_key(
    pool: &SqlitePool,
    id: i64,
    chosen: Option<i64>,
    key: &str,
) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET import_key = ?
         WHERE id = ? AND state = 'on_its_way' AND chosen_result_id = ?",
    )
    .bind(key)
    .bind(id)
    .bind(chosen)
    .execute(pool)
    .await?;
    Ok(())
}

/// End the import of request `id`'s pick `chosen`: the book is in the library. With
/// `remove_download`, a download Omnibus added also goes on the removal list, unless a removal
/// is already waiting there.
pub async fn mark_ready(
    pool: &SqlitePool,
    id: i64,
    chosen: Option<i64>,
    remove_download: bool,
) -> Result<(), RequestError> {
    const QUEUE: &str = "?3 AND client_adopted = 0 AND remove_hash IS NULL";
    sqlx::query(&format!(
        "UPDATE book_requests SET state = 'ready', updated_at = {NOW},
             remove_hash = CASE WHEN {QUEUE} THEN client_hash ELSE remove_hash END,
             remove_since = CASE WHEN {QUEUE} THEN NULL ELSE remove_since END
         WHERE id = ?1 AND state = 'on_its_way' AND chosen_result_id = ?2"
    ))
    .bind(id)
    .bind(chosen)
    .bind(remove_download)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record a download's risen `progress` at `moved_at` and when the client now expects it to
/// finish (`None`: it can't tell), for request `id`'s pick `chosen` while it is on its way.
pub async fn record_progress(
    pool: &SqlitePool,
    id: i64,
    chosen: Option<i64>,
    progress: f64,
    moved_at: i64,
    expected_done_at: Option<i64>,
) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET progress = ?, moved_at = ?, expected_done_at = ?
         WHERE id = ? AND state = 'on_its_way' AND chosen_result_id = ?",
    )
    .bind(progress)
    .bind(moved_at)
    .bind(expected_done_at)
    .bind(id)
    .bind(chosen)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record when the client expects the download of request `id`'s pick `chosen` to finish
/// (`None`: it can't tell), while it is on its way.
pub async fn record_expected_done_at(
    pool: &SqlitePool,
    id: i64,
    chosen: Option<i64>,
    expected_done_at: Option<i64>,
) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET expected_done_at = ?
         WHERE id = ? AND state = 'on_its_way' AND chosen_result_id = ?",
    )
    .bind(expected_done_at)
    .bind(id)
    .bind(chosen)
    .execute(pool)
    .await?;
    Ok(())
}

/// End a request's pick `chosen`, picked or downloading, as stuck for `reason`. `detail` is
/// for admins.
pub async fn mark_stuck(
    pool: &SqlitePool,
    id: i64,
    chosen: Option<i64>,
    reason: StuckReason,
    detail: &str,
) -> Result<(), RequestError> {
    sqlx::query(&format!(
        "UPDATE book_requests
         SET state = 'stuck', stuck_reason = ?, stuck_detail = ?, expected_done_at = NULL,
             updated_at = {NOW}
         WHERE id = ? AND state IN ('chosen', 'on_its_way') AND chosen_result_id = ?"
    ))
    .bind(reason.as_str())
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
         WHERE state = 'chosen' OR cancel_at IS NOT NULL OR remove_hash IS NOT NULL\n            OR legacy_tag IS NOT NULL OR {DOWNLOADING})"
    ))
    .fetch_one(pool)
    .await?)
}
