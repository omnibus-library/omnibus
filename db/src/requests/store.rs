//! Rows of the book-request tables: a reader's request for one format of a book and the
//! versions its search found. The handlers and the search task both go through here, so
//! the state rules (one live request per reader, book and format; a version only chosen
//! while the request waits on the reader) hold in one place.

use omnibus_shared::{
    ExternalBookMeta, ReleaseProtocol, RequestKind, RequestState, RequestVersion, StuckReason,
};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

use crate::author_photos::RemoteImageConfig;
use crate::metadata_lookup::provider_cover_image_config;
use crate::scan::{create_fileless_from_meta, fetch_candidate_cover};

use super::rank::Ranked;

/// A request live for its reader: searching, waiting on a pick, picked or downloading.
const LIVE_STATES: &str = "('looking', 'choose', 'chosen', 'on_its_way')";

/// A request whose picked version is still downloading. A finished download stays
/// `on_its_way` with `progress = 1` for the import to pick up.
const DOWNLOADING: &str = "(state = 'on_its_way' AND (progress IS NULL OR progress < 1))";

const NOW: &str = "strftime('%s', 'now')";

const COLUMNS: &str = "id, book_uuid, user_id, kind, state, stuck_reason, stuck_detail, \
                       chosen_result_id, client_hash, client_adopted, legacy_tag, import_key, remove_hash, remove_since, progress, moved_at, expected_done_at, cancel_at, cancelled_by, \
                       prior_state, note, offers_cover, cover_candidate, created_at, updated_at";

/// Why a request could not be recorded or changed.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    /// The reader already has as many live requests as allowed.
    #[error("too many requests in progress")]
    TooManyLive,
    /// The request is not in a state this change applies to.
    #[error("the request is not in the right state")]
    WrongState,
    /// The request has no such version to pick.
    #[error("no such version")]
    NotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Books(#[from] crate::books::BooksError),
    /// Making the book from a provider's record failed.
    #[error(transparent)]
    Scan(#[from] crate::scan::ScanError),
}

/// One request as stored. `stuck_detail` is for admins only; the handler withholds it.
#[derive(Debug, Clone, PartialEq)]
pub struct RequestRow {
    pub id: i64,
    pub book_uuid: String,
    pub user_id: i64,
    pub kind: RequestKind,
    pub state: RequestState,
    pub stuck_reason: Option<StuckReason>,
    pub stuck_detail: Option<String>,
    pub chosen_result_id: Option<i64>,
    /// The info hash of the live download in the client; never sent to a reader.
    pub client_hash: Option<String>,
    /// True when the client already held the torrent, so Omnibus never removes it.
    pub client_adopted: bool,
    /// A tag an earlier version put on the download, until it is found by hash.
    pub legacy_tag: Option<String>,
    /// The library-relative key of the file a finished download was placed as, once it has
    /// been; a retried import resumes from it.
    pub import_key: Option<String>,
    /// A download to take out of the client, and `remove_since` when that began (Unix
    /// seconds; `None` once the client has shown it).
    pub remove_hash: Option<String>,
    pub remove_since: Option<i64>,
    /// How much of the download is done, 0 to 1.
    pub progress: Option<f64>,
    /// When the download last gained bytes, in Unix seconds.
    pub moved_at: Option<i64>,
    /// When the client expects the download to finish, in Unix seconds.
    pub expected_done_at: Option<i64>,
    /// When the client is told to remove the download, in Unix seconds.
    pub cancel_at: Option<i64>,
    pub cancelled_by: Option<i64>,
    /// The state Undo restores while `cancel_at` is ahead.
    pub prior_state: Option<RequestState>,
    pub note: Option<String>,
    /// False for a request whose book was made just for it: its import keeps the merge's own cover.
    pub offers_cover: bool,
    /// The uuid the download was scanned in as, whose cover is on offer; None once taken or kept.
    pub cover_candidate: Option<String>,
    /// Unix seconds.
    pub created_at: i64,
    /// Unix seconds.
    pub updated_at: i64,
}

/// The outcome of [`start`].
#[derive(Debug, Clone, PartialEq)]
pub struct Started {
    pub request: RequestRow,
    /// False when the reader already had a live request and it is returned unchanged.
    pub created: bool,
}

/// What a search came to.
pub enum SearchOutcome {
    /// Every result, kept and dropped, in rank order.
    Found(Vec<Ranked>),
    Stuck {
        reason: StuckReason,
        detail: Option<String>,
    },
}

/// A `book_request_results` row as a version; `rejected` is whether it was picked and given up.
fn row_to_version(r: &SqliteRow) -> Result<RequestVersion, sqlx::Error> {
    Ok(RequestVersion {
        id: r.try_get("id")?,
        title: r.try_get("title")?,
        size_bytes: r.try_get("size_bytes")?,
        format: r.try_get("format")?,
        indexer: r.try_get("indexer")?,
        seeders: r.try_get("seeders")?,
        protocol: r
            .try_get::<Option<String>, _>("protocol")?
            .as_deref()
            .and_then(ReleaseProtocol::parse),
        best_match: r.try_get::<i64, _>("best_match")? != 0,
        rejected: r.try_get::<i64, _>("tried")? != 0,
    })
}

fn row_to_request(row: &SqliteRow) -> Result<RequestRow, sqlx::Error> {
    let corrupt = |column: &str, value: String| {
        sqlx::Error::Decode(format!("book_requests.{column} holds {value:?}").into())
    };
    let kind: String = row.try_get("kind")?;
    let state: String = row.try_get("state")?;
    let reason: Option<String> = row.try_get("stuck_reason")?;
    let prior: Option<String> = row.try_get("prior_state")?;
    Ok(RequestRow {
        id: row.try_get("id")?,
        book_uuid: row.try_get("book_uuid")?,
        user_id: row.try_get("user_id")?,
        kind: RequestKind::from_db(&kind).ok_or_else(|| corrupt("kind", kind))?,
        state: RequestState::from_db(&state).ok_or_else(|| corrupt("state", state))?,
        stuck_reason: reason
            .map(|r| StuckReason::from_db(&r).ok_or_else(|| corrupt("stuck_reason", r)))
            .transpose()?,
        stuck_detail: row.try_get("stuck_detail")?,
        chosen_result_id: row.try_get("chosen_result_id")?,
        client_hash: row.try_get("client_hash")?,
        client_adopted: row.try_get::<i64, _>("client_adopted")? != 0,
        legacy_tag: row.try_get("legacy_tag")?,
        import_key: row.try_get("import_key")?,
        remove_hash: row.try_get("remove_hash")?,
        remove_since: row.try_get("remove_since")?,
        progress: row.try_get("progress")?,
        moved_at: row.try_get("moved_at")?,
        expected_done_at: row.try_get("expected_done_at")?,
        cancel_at: row.try_get("cancel_at")?,
        cancelled_by: row.try_get("cancelled_by")?,
        prior_state: prior
            .map(|p| RequestState::from_db(&p).ok_or_else(|| corrupt("prior_state", p)))
            .transpose()?,
        note: row.try_get("note")?,
        offers_cover: row.try_get::<i64, _>("offers_cover")? != 0,
        cover_candidate: row.try_get("cover_candidate")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Start `user_id`'s request for `kind` of `book_uuid`, or return the one they already have
/// live. Refuses a new request once they hold `max_live`. Find, count and insert run in one
/// write transaction, so a double click cannot create two rows.
pub async fn start(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
    kind: RequestKind,
    max_live: i64,
) -> Result<Started, RequestError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let existing = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests
         WHERE user_id = ? AND book_uuid = ? AND kind = ? AND state IN {LIVE_STATES}"
    ))
    .bind(user_id)
    .bind(book_uuid)
    .bind(kind.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(row) = existing {
        return Ok(Started {
            request: row_to_request(&row)?,
            created: false,
        });
    }
    // A book made for a request keeps its cover whoever asks next, until it is a real book:
    // it has gained a file or a physical copy.
    let offers_cover: bool = sqlx::query_scalar(
        "SELECT NOT EXISTS (SELECT 1 FROM book_requests WHERE book_uuid = ?1 AND offers_cover = 0)
             OR EXISTS (SELECT 1 FROM physical_copies WHERE book_uuid = ?1)
             OR EXISTS (SELECT 1 FROM book_files bf JOIN books b ON b.id = bf.book_id
                         WHERE b.uuid = ?1)",
    )
    .bind(book_uuid)
    .fetch_one(&mut *tx)
    .await?;
    let request = insert_looking(&mut tx, user_id, book_uuid, kind, max_live, offers_cover).await?;
    tx.commit().await?;
    Ok(Started {
        request,
        created: true,
    })
}

/// How many requests `user_id` has live.
async fn live_count<'e>(
    executor: impl sqlx::Executor<'e, Database = sqlx::Sqlite>,
    user_id: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM book_requests WHERE user_id = ? AND state IN {LIVE_STATES}"
    ))
    .bind(user_id)
    .fetch_one(executor)
    .await
}

/// Insert a `looking` request on `tx`, refused once the reader holds `max_live`. `offers_cover`
/// is whether a download's sharper cover may be offered for the book; a book made for the
/// request has no cover of its own worth replacing.
async fn insert_looking(
    tx: &mut sqlx::SqliteConnection,
    user_id: i64,
    book_uuid: &str,
    kind: RequestKind,
    max_live: i64,
    offers_cover: bool,
) -> Result<RequestRow, RequestError> {
    if live_count(&mut *tx, user_id).await? >= max_live {
        return Err(RequestError::TooManyLive);
    }
    let row = sqlx::query(&format!(
        "INSERT INTO book_requests (book_uuid, user_id, kind, state, offers_cover)
         VALUES (?, ?, ?, 'looking', ?) RETURNING {COLUMNS}"
    ))
    .bind(book_uuid)
    .bind(user_id)
    .bind(kind.as_str())
    .bind(offers_cover)
    .fetch_one(&mut *tx)
    .await?;
    Ok(row_to_request(&row)?)
}

/// Start `user_id`'s request for `kind` of a book the library lacks, made from `meta` as a
/// file-less book. The cover is fetched first, unless the reader is already at `max_live`; the
/// live-cap check, the book and the request share one write transaction, so a refusal leaves
/// no book behind.
pub async fn start_for_new_book(
    pool: &SqlitePool,
    user_id: i64,
    meta: &ExternalBookMeta,
    kind: RequestKind,
    max_live: i64,
) -> Result<RequestRow, RequestError> {
    start_for_new_book_with(
        pool,
        user_id,
        meta,
        kind,
        max_live,
        &provider_cover_image_config(false),
    )
    .await
}

/// [`start_for_new_book`] with an injectable cover-fetch config, for a test that points the
/// fetch at a loopback origin.
pub(crate) async fn start_for_new_book_with(
    pool: &SqlitePool,
    user_id: i64,
    meta: &ExternalBookMeta,
    kind: RequestKind,
    max_live: i64,
    image_config: &RemoteImageConfig,
) -> Result<RequestRow, RequestError> {
    // Read-only and early, so a refused reader costs no network fetch or write lock; the
    // transaction below stays the authoritative check.
    if live_count(pool, user_id).await? >= max_live {
        return Err(RequestError::TooManyLive);
    }
    let cover = fetch_candidate_cover(meta, image_config).await;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let created = create_fileless_from_meta(&mut tx, meta, cover, Some(user_id)).await?;
    let request = insert_looking(&mut tx, user_id, &created.uuid, kind, max_live, false).await?;
    tx.commit().await?;
    created.settle_cover(pool).await;
    Ok(request)
}

/// The request with this id, if any.
pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<RequestRow>, RequestError> {
    let row = sqlx::query(&format!("SELECT {COLUMNS} FROM book_requests WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(row_to_request).transpose()?)
}

/// The versions worth showing for a request, best first: the ones to choose from, then the
/// ones that were picked and given up (`rejected`). Versions the ranking dropped are never
/// returned.
pub async fn versions(
    pool: &SqlitePool,
    request_id: i64,
) -> Result<Vec<RequestVersion>, RequestError> {
    let rows = sqlx::query(
        "SELECT id, title, size_bytes, format, indexer, seeders, protocol, best_match, tried FROM book_request_results
         WHERE request_id = ? AND (rejected = 0 OR tried = 1) ORDER BY tried, score DESC, id",
    )
    .bind(request_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(row_to_version)
        .collect::<Result<Vec<_>, sqlx::Error>>()?)
}

/// Record how a search ended, but only for a request still `looking`: one that was
/// restarted, picked or answered meanwhile keeps its state. Versions given up earlier stay
/// in the table and are not offered again; a search that finds nothing else ends `not_found`.
pub async fn finish_search(
    pool: &SqlitePool,
    id: i64,
    outcome: SearchOutcome,
) -> Result<(), RequestError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let outcome = match outcome {
        SearchOutcome::Found(ranked) => without_given_up(&mut tx, id, ranked).await?,
        stuck => stuck,
    };
    let (state, reason, detail) = match &outcome {
        SearchOutcome::Found(_) => (RequestState::Choose, None, None),
        SearchOutcome::Stuck { reason, detail } => (
            RequestState::Stuck,
            Some(reason.as_str()),
            detail.as_deref(),
        ),
    };
    let moved = sqlx::query(&format!(
        "UPDATE book_requests SET state = ?, stuck_reason = ?, stuck_detail = ?, updated_at = {NOW}
         WHERE id = ? AND state = 'looking'"
    ))
    .bind(state.as_str())
    .bind(reason)
    .bind(detail)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if moved == 0 {
        return Ok(());
    }
    if let SearchOutcome::Found(ranked) = &outcome {
        sqlx::query("DELETE FROM book_request_results WHERE request_id = ? AND tried = 0")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for r in ranked {
            insert_result(&mut tx, id, r).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// `ranked` without the releases this request already tried and gave up; `not_found` when none that
/// was worth showing is left.
async fn without_given_up(
    tx: &mut sqlx::SqliteConnection,
    id: i64,
    mut ranked: Vec<Ranked>,
) -> Result<SearchOutcome, sqlx::Error> {
    let given_up: Vec<String> = sqlx::query_scalar(
        "SELECT guid FROM book_request_results WHERE request_id = ? AND tried = 1",
    )
    .bind(id)
    .fetch_all(tx)
    .await?;
    ranked.retain(|r| !given_up.contains(&r.release.guid));
    if ranked.iter().all(|r| r.rejected) {
        return Ok(SearchOutcome::Stuck {
            reason: StuckReason::NotFound,
            detail: None,
        });
    }
    Ok(SearchOutcome::Found(ranked))
}

async fn insert_result(
    tx: &mut sqlx::SqliteConnection,
    request_id: i64,
    ranked: &Ranked,
) -> Result<(), sqlx::Error> {
    let r = &ranked.release;
    sqlx::query(
        "INSERT INTO book_request_results
         (request_id, guid, title, size_bytes, format, seeders, protocol, indexer, download_url, score, best_match, rejected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(request_id)
    .bind(&r.guid)
    .bind(&r.title)
    .bind(r.size_bytes)
    .bind(&ranked.format)
    .bind(r.seeders)
    .bind(r.protocol.map(ReleaseProtocol::as_str))
    .bind(&r.indexer)
    .bind(&r.link)
    .bind(ranked.score)
    .bind(ranked.best_match)
    .bind(ranked.rejected)
    .execute(tx)
    .await?;
    Ok(())
}

/// Send a `looking` or `stuck` request back to `looking` and forget what it found, and say
/// what it is now in. A request stuck on a stopped download keeps what was found: it goes
/// back to choosing, as [`swap`] does. One stuck on `couldnt_add` goes back to the import,
/// keeping its download and where it was filed, so nothing is fetched or searched again; like
/// [`undo_cancel`] it is refused when the reader has meanwhile asked for the same book
/// ([`RequestError::WrongState`]) or holds `max_live` requests ([`RequestError::TooManyLive`]).
/// [`RequestError::WrongState`] for one already waiting on a pick or picked.
pub async fn restart(
    pool: &SqlitePool,
    id: i64,
    now: i64,
    max_live: i64,
) -> Result<RequestState, RequestError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let current: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT state, stuck_reason FROM book_requests WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let stuck_on = |reason: StuckReason| {
        current.as_ref().is_some_and(|(state, stuck)| {
            state == "stuck" && stuck.as_deref() == Some(reason.as_str())
        })
    };
    if stuck_on(StuckReason::StoppedMoving) {
        let row = change::swap_in(&mut tx, id, now, None).await?;
        tx.commit().await?;
        return Ok(row.state);
    }
    if stuck_on(StuckReason::CouldntAdd) {
        change::ensure_room(&mut tx, id, max_live).await?;
        sqlx::query(&format!(
            "UPDATE book_requests
             SET state = 'on_its_way', progress = 1, stuck_reason = NULL, stuck_detail = NULL,
                 updated_at = {NOW}
             WHERE id = ?"
        ))
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(RequestState::OnItsWay);
    }
    let moved = sqlx::query(&format!(
        "UPDATE book_requests
         SET state = 'looking', stuck_reason = NULL, stuck_detail = NULL, updated_at = {NOW}
         WHERE id = ? AND state IN ('looking', 'stuck')"
    ))
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if moved == 0 {
        return Err(RequestError::WrongState);
    }
    sqlx::query("DELETE FROM book_request_results WHERE request_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(RequestState::Looking)
}

/// Pick `result_id` for request `id`. The version must be a kept one of this request, and the
/// request must be waiting on a pick ([`RequestError::WrongState`] otherwise;
/// [`RequestError::NotFound`] when the version is not this request's or was dropped). The
/// checks and the change are one statement, so a double click picks once.
pub async fn choose(pool: &SqlitePool, id: i64, result_id: i64) -> Result<(), RequestError> {
    let moved = sqlx::query(&format!(
        "UPDATE book_requests SET state = 'chosen', chosen_result_id = ?1, note = NULL, updated_at = {NOW}
         WHERE id = ?2 AND state = 'choose'
           AND EXISTS (SELECT 1 FROM book_request_results
                       WHERE id = ?1 AND request_id = ?2 AND rejected = 0)"
    ))
    .bind(result_id)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if moved == 1 {
        return Ok(());
    }
    match get(pool, id).await? {
        Some(r) if r.state != RequestState::Choose => Err(RequestError::WrongState),
        _ => Err(RequestError::NotFound),
    }
}

mod change;
mod download;
mod list;

pub use change::{cancel, swap, undo_cancel, CANCEL_GRACE_SECS};
pub use download::{
    awaiting_add, awaiting_import, claim_due_cancels, claim_hash, downloading, finish_removal,
    has_download_work, hash_in_use, mark_on_its_way, mark_ready, mark_removal_seen, mark_stuck,
    pending_removals, pick_link, record_expected_done_at, record_progress, release_claim,
    resolve_legacy_tag, set_import_key, unix_now, with_legacy_tag,
};
pub use list::{list, ListFilter, Listed};

#[cfg(test)]
mod tests;
