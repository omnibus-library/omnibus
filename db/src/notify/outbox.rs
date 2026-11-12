//! The outbox: notifications queued in the transaction that caused them, and the drain that
//! sends each to its connection. A row is claimed before it is sent by pushing its due time
//! a lease ahead, so two passes never send it twice and a crash mid-send leaves it to be
//! tried again once the lease runs out. A refusal worth retrying backs off from 30 seconds,
//! doubling to an hour, or longer when the provider's `Retry-After` asks; the eighth failed
//! try, or any refusal that retrying won't change, fails the row. Finished rows are kept 30
//! days for the connection list, then pruned.

use std::time::Duration;

use omnibus_shared::{EbookMetadata, RequestKind};
use sqlx::{Row, SqliteConnection, SqlitePool};
use tokio::sync::Notify;

use crate::auth::now_unix;

use super::deliver::{deliver, DeliverError};
use super::event::{Event, RequestNeedsChooser};
use super::render::render;
use super::store::get_connection;
use super::NotifyError;

/// How many tries a notification gets before it is marked failed.
pub const MAX_ATTEMPTS: i64 = 8;

/// How long a delivered or failed notification is kept, in seconds.
pub const RETENTION_SECS: i64 = 30 * 24 * 3600;

const FIRST_BACKOFF_SECS: i64 = 30;
const MAX_BACKOFF_SECS: i64 = 3600;

/// How far a claim pushes a row's due time: well past a send's timeout, so only a crash
/// lets it run out.
const CLAIM_SECS: i64 = 300;

/// The most rows one pass claims; the rest wait for the next.
const BATCH: i64 = 25;

const PRUNE_EVERY_SECS: i64 = 3600;
const BUSY_WAIT: Duration = Duration::from_secs(5);
const IDLE_WAIT: Duration = Duration::from_secs(30);

const NOW: &str = "strftime('%s', 'now')";

static KICK: Notify = Notify::const_new();

/// What one drain pass did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Drained {
    pub delivered: usize,
    /// Refused or unanswered, and due again later.
    pub retrying: usize,
    pub failed: usize,
}

/// A queued row this pass holds the claim on.
struct Claimed {
    id: i64,
    connection_id: i64,
    event: String,
    payload: String,
    attempts: i64,
}

/// How one send went.
enum Outcome {
    Delivered,
    Retry {
        after: Option<Duration>,
        message: String,
    },
    Failed(String),
}

/// Wake the drain loop now, not at its next pass. A wake while nothing waits is kept for
/// the next wait.
pub fn kick() {
    KICK.notify_one();
}

/// Resolves at the next [`kick`].
pub async fn kicked() {
    KICK.notified().await;
}

/// Queue a "request needs a chooser" notification of request `request_id` for every enabled
/// connection subscribed to it, unless its requester may pick a version. Runs on the
/// caller's transaction, so it is queued once per arrival and only if the arrival commits.
/// `book` is the requested book as shown, read before the transaction. Returns how many.
pub async fn enqueue_request_needs_chooser(
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
    // An unreadable `events` reads as subscribed to nothing rather than failing the caller.
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

/// Send each queued notification that is due, up to a batch, one at a time. The links are
/// built from the public URL in effect now, not when the event was queued.
pub async fn drain_due(
    pool: &SqlitePool,
    client: &reqwest::Client,
) -> Result<Drained, NotifyError> {
    let due: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM notification_deliveries
          WHERE state = 'queued' AND next_attempt_at <= ?
          ORDER BY next_attempt_at, id LIMIT ?",
    )
    .bind(now_unix())
    .bind(BATCH)
    .fetch_all(pool)
    .await?;
    let mut drained = Drained::default();
    if due.is_empty() {
        return Ok(drained);
    }
    let public_url = crate::effective_public_url(pool)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "read the public URL; sending notifications without a link");
            None
        });
    for id in due {
        let Some(claimed) = claim(pool, id).await? else {
            continue;
        };
        let outcome = send(pool, client, &claimed, public_url.as_deref()).await;
        match &outcome {
            Outcome::Delivered => drained.delivered += 1,
            Outcome::Retry { .. } if claimed.attempts < MAX_ATTEMPTS => drained.retrying += 1,
            Outcome::Retry { .. } | Outcome::Failed(_) => drained.failed += 1,
        }
        record(pool, &claimed, outcome).await?;
    }
    Ok(drained)
}

/// Take row `id` if it is still queued and due, counting the try; `None` when another pass
/// took it first.
async fn claim(pool: &SqlitePool, id: i64) -> Result<Option<Claimed>, NotifyError> {
    let row = sqlx::query(
        "UPDATE notification_deliveries
            SET attempts = attempts + 1, next_attempt_at = ?1 + ?2
          WHERE id = ?3 AND state = 'queued' AND next_attempt_at <= ?1
         RETURNING connection_id, event, payload, attempts",
    )
    .bind(now_unix())
    .bind(CLAIM_SECS)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(Claimed {
        id,
        connection_id: row.try_get("connection_id")?,
        event: row.try_get("event")?,
        payload: row.try_get("payload")?,
        attempts: row.try_get("attempts")?,
    }))
}

/// Render the claimed row for its connection as it is now, and send it.
async fn send(
    pool: &SqlitePool,
    client: &reqwest::Client,
    claimed: &Claimed,
    public_url: Option<&str>,
) -> Outcome {
    let connection = match get_connection(pool, claimed.connection_id).await {
        Ok(connection) => connection,
        Err(NotifyError::NotFound) => return Outcome::Failed("the connection was deleted".into()),
        Err(error) => {
            tracing::warn!(%error, "read a notification connection");
            return Outcome::Retry {
                after: None,
                message: "the connection could not be read".to_string(),
            };
        }
    };
    if !connection.enabled {
        return Outcome::Failed("not sent: the connection is turned off".to_string());
    }
    let Some(event) = Event::from_stored(&claimed.event, &claimed.payload) else {
        return Outcome::Failed("the queued notification could not be read".to_string());
    };
    match deliver(client, render(&connection.settings, &event, public_url)).await {
        Ok(()) => Outcome::Delivered,
        Err(DeliverError::Retry { after, message }) => Outcome::Retry { after, message },
        Err(DeliverError::Permanent { message }) => Outcome::Failed(message),
    }
}

/// Write how the send went: delivered, due again after a backoff, or failed for good.
async fn record(pool: &SqlitePool, claimed: &Claimed, outcome: Outcome) -> Result<(), NotifyError> {
    let now = now_unix();
    let query = match outcome {
        Outcome::Delivered => sqlx::query(
            "UPDATE notification_deliveries
                SET state = 'delivered', finished_at = ?1, last_error = NULL
              WHERE id = ?2 AND state = 'queued'",
        )
        .bind(now),
        Outcome::Retry { after, message } if claimed.attempts < MAX_ATTEMPTS => {
            let after = after.map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX));
            sqlx::query(
                "UPDATE notification_deliveries SET next_attempt_at = ?1, last_error = ?2
                  WHERE id = ?3 AND state = 'queued'",
            )
            .bind(now.saturating_add(backoff(claimed.attempts).max(after)))
            .bind(message)
        }
        Outcome::Retry { message, .. } | Outcome::Failed(message) => {
            tracing::warn!(
                connection = claimed.connection_id,
                error = %message,
                "gave up on a notification"
            );
            sqlx::query(
                "UPDATE notification_deliveries
                    SET state = 'failed', finished_at = ?1, last_error = ?2
                  WHERE id = ?3 AND state = 'queued'",
            )
            .bind(now)
            .bind(message)
        }
    };
    query.bind(claimed.id).execute(pool).await?;
    Ok(())
}

/// Seconds to wait after the `attempts`th failed try: 30, doubling, at most an hour.
pub(super) fn backoff(attempts: i64) -> i64 {
    let doublings = u32::try_from(attempts.saturating_sub(1).clamp(0, 16)).unwrap_or(16);
    (FIRST_BACKOFF_SECS << doublings).min(MAX_BACKOFF_SECS)
}

/// When the next queued notification falls due, in Unix seconds; `None` when none is queued.
pub async fn next_due(pool: &SqlitePool) -> Result<Option<i64>, NotifyError> {
    Ok(sqlx::query_scalar(
        "SELECT MIN(next_attempt_at) FROM notification_deliveries WHERE state = 'queued'",
    )
    .fetch_one(pool)
    .await?)
}

/// Delete every delivered or failed notification that finished before `before`, in Unix
/// seconds. Returns how many.
pub async fn prune_finished(pool: &SqlitePool, before: i64) -> Result<u64, NotifyError> {
    Ok(sqlx::query(
        "DELETE FROM notification_deliveries
          WHERE state IN ('delivered', 'failed') AND finished_at < ?",
    )
    .bind(before)
    .execute(pool)
    .await?
    .rows_affected())
}

/// One turn of the drain loop: send what is due, prune at most hourly (`last_prune` holds
/// when, in Unix seconds), and say how long to wait before the next turn.
pub async fn drain_tick(
    pool: &SqlitePool,
    client: &reqwest::Client,
    last_prune: &mut Option<i64>,
) -> Duration {
    match drain_due(pool, client).await {
        Ok(d) if d != Drained::default() => {
            tracing::info!(
                delivered = d.delivered,
                retrying = d.retrying,
                failed = d.failed,
                "sent notifications"
            );
        }
        Ok(_) => {}
        Err(error) => tracing::warn!(%error, "send queued notifications"),
    }
    let now = now_unix();
    if last_prune.is_none_or(|at| now - at >= PRUNE_EVERY_SECS) {
        match prune_finished(pool, now - RETENTION_SECS).await {
            Ok(_) => *last_prune = Some(now),
            Err(error) => tracing::warn!(%error, "prune finished notifications"),
        }
    }
    match next_due(pool).await {
        Ok(Some(at)) => {
            Duration::from_secs(u64::try_from(at - now).unwrap_or(0)).clamp(BUSY_WAIT, IDLE_WAIT)
        }
        Ok(None) => IDLE_WAIT,
        Err(error) => {
            tracing::warn!(%error, "read the notification outbox");
            IDLE_WAIT
        }
    }
}
