//! Rows of the book-request tables: a reader's request for one format of a book and the
//! versions its search found. The handlers and the search task both go through here, so
//! the state rules (one live request per reader, book and format; a version only chosen
//! while the request waits on the reader) hold in one place.

use omnibus_shared::{RequestKind, RequestState, RequestVersion, StuckReason};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

/// A request live for its reader: still searching, waiting on a pick, or picked.
const LIVE_STATES: &str = "('looking', 'choose', 'chosen')";

const COLUMNS: &str = "id, book_uuid, user_id, kind, state, stuck_reason, stuck_detail, \
                       chosen_result_id, created_at, updated_at";

/// Why a request could not be recorded or changed.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    /// The reader already has as many live requests as allowed.
    #[error("too many requests in progress")]
    TooManyLive,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// One request as stored. `stuck_detail` is for admins only; the handler withholds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestRow {
    pub id: i64,
    pub book_uuid: String,
    pub user_id: i64,
    pub kind: RequestKind,
    pub state: RequestState,
    pub stuck_reason: Option<StuckReason>,
    pub stuck_detail: Option<String>,
    pub chosen_result_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

/// The outcome of [`start`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Started {
    pub request: RequestRow,
    /// False when the reader already had a live request and it is returned unchanged.
    pub created: bool,
}

fn row_to_request(row: &SqliteRow) -> Result<RequestRow, sqlx::Error> {
    let corrupt = |column: &str, value: String| {
        sqlx::Error::Decode(format!("book_requests.{column} holds {value:?}").into())
    };
    let kind: String = row.try_get("kind")?;
    let state: String = row.try_get("state")?;
    let reason: Option<String> = row.try_get("stuck_reason")?;
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
    let live: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM book_requests WHERE user_id = ? AND state IN {LIVE_STATES}"
    ))
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    if live >= max_live {
        return Err(RequestError::TooManyLive);
    }
    let row = sqlx::query(&format!(
        "INSERT INTO book_requests (book_uuid, user_id, kind, state)
         VALUES (?, ?, ?, 'looking') RETURNING {COLUMNS}"
    ))
    .bind(book_uuid)
    .bind(user_id)
    .bind(kind.as_str())
    .fetch_one(&mut *tx)
    .await?;
    let request = row_to_request(&row)?;
    tx.commit().await?;
    Ok(Started {
        request,
        created: true,
    })
}

/// The request with this id, if any.
pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<RequestRow>, RequestError> {
    let row = sqlx::query(&format!("SELECT {COLUMNS} FROM book_requests WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(row_to_request).transpose()?)
}

/// Every request for the book, newest first.
pub async fn list_for_book(
    pool: &SqlitePool,
    book_uuid: &str,
) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE book_uuid = ? ORDER BY id DESC"
    ))
    .bind(book_uuid)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(row_to_request)
        .collect::<Result<Vec<_>, sqlx::Error>>()?)
}

/// The versions worth showing for a request, best first. Rejected ones are kept in the
/// table but never returned.
pub async fn versions(
    pool: &SqlitePool,
    request_id: i64,
) -> Result<Vec<RequestVersion>, RequestError> {
    let rows = sqlx::query(
        "SELECT id, title, size_bytes, format, indexer, best_match FROM book_request_results
         WHERE request_id = ? AND rejected = 0 ORDER BY score DESC, id",
    )
    .bind(request_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok(RequestVersion {
                id: r.try_get("id")?,
                title: r.try_get("title")?,
                size_bytes: r.try_get("size_bytes")?,
                format: r.try_get("format")?,
                indexer: r.try_get("indexer")?,
                best_match: r.try_get::<i64, _>("best_match")? != 0,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?)
}

#[cfg(test)]
mod tests;
