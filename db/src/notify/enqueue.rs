//! Queueing an event's notifications on the transaction of the change that caused it, one
//! `queued` row per enabled connection subscribed to the event. Run inside a savepoint, so
//! a failure here is undone alone and logged: a notification is never worth the change it
//! reports. The request search calls it as a request reaches "Choose a version".

use omnibus_shared::{EbookMetadata, RequestKind};
use sqlx::{Connection, Row, SqliteConnection};

use super::event::{Event, RequestNeedsChooser};
use super::NotifyError;

const NOW: &str = "strftime('%s', 'now')";

/// Queue a "request needs a chooser" notification of request `request_id` for every enabled
/// connection subscribed to it, unless its requester may pick a version. On the caller's
/// transaction, so it is queued once per arrival and only if the arrival commits; a failure
/// is logged and costs the caller nothing. `book` is the requested book as shown, read
/// before the transaction. Returns how many were queued.
pub async fn enqueue_request_needs_chooser(
    conn: &mut SqliteConnection,
    request_id: i64,
    book: Option<&EbookMetadata>,
) -> u64 {
    match in_savepoint(conn, request_id, book).await {
        Ok(queued) => queued,
        Err(error) => {
            tracing::warn!(%error, request = request_id, "queue a request's notifications");
            0
        }
    }
}

async fn in_savepoint(
    conn: &mut SqliteConnection,
    request_id: i64,
    book: Option<&EbookMetadata>,
) -> Result<u64, NotifyError> {
    // On a connection already in a transaction, `begin` opens a savepoint.
    let mut savepoint = conn.begin().await?;
    match chooser_rows(&mut savepoint, request_id, book).await {
        Ok(queued) => {
            savepoint.commit().await?;
            Ok(queued)
        }
        Err(error) => {
            savepoint.rollback().await?;
            Err(error)
        }
    }
}

async fn chooser_rows(
    conn: &mut SqliteConnection,
    request_id: i64,
    book: Option<&EbookMetadata>,
) -> Result<u64, NotifyError> {
    let row = sqlx::query(
        "SELECT q.book_uuid, q.kind, u.is_admin, u.can_choose_request_versions,
                COALESCE(u.display_name, u.username) AS requester,
                (SELECT COUNT(*) FROM book_request_results r
                  WHERE r.request_id = q.id AND r.rejected = 0 AND r.tried = 0) AS versions
           FROM book_requests q
           JOIN users u ON u.id = q.user_id
          WHERE q.id = ?",
    )
    .bind(request_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else {
        return Ok(0);
    };
    if row.try_get::<bool, _>("is_admin")?
        || row.try_get::<bool, _>("can_choose_request_versions")?
    {
        return Ok(0);
    }
    let kind: String = row.try_get("kind")?;
    let kind = RequestKind::from_db(&kind)
        .ok_or_else(|| sqlx::Error::Decode(format!("book_requests.kind holds {kind:?}").into()))?;
    let event = Event::RequestNeedsChooser(RequestNeedsChooser {
        request_id,
        book_uuid: row.try_get("book_uuid")?,
        title: book
            .and_then(|b| b.title.clone())
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| "Untitled".to_string()),
        author: book
            .and_then(|b| b.creators.first())
            .map(|c| c.name.clone()),
        kind,
        requester: row.try_get("requester")?,
        versions: row.try_get("versions")?,
    });
    queue(conn, &event).await
}

/// One `queued` row of `event` for every enabled connection subscribed to it.
async fn queue(conn: &mut SqliteConnection, event: &Event) -> Result<u64, NotifyError> {
    let payload = event.payload().map_err(|e| sqlx::Error::Encode(e.into()))?;
    // An unreadable `events` reads as subscribed to nothing.
    let queued = sqlx::query(&format!(
        "INSERT INTO notification_deliveries (connection_id, event, payload, state, next_attempt_at)
         SELECT c.id, ?1, ?2, 'queued', {NOW}
           FROM notification_connections c
          WHERE c.enabled = 1
            AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(c.events)
                                                     THEN c.events ELSE '[]' END) e
                         WHERE e.value = ?1)"
    ))
    .bind(event.name().as_str())
    .bind(payload)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(queued)
}
