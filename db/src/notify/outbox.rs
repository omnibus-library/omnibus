//! The outbox drain: sending each queued notification to its connection. A row is claimed
//! before it is sent by pushing its due time a lease ahead, so two passes never send it
//! twice and a crash mid-send leaves it to be tried again once the lease runs out. A refusal
//! worth retrying backs off from 30 seconds, doubling to an hour, or longer when the
//! provider's `Retry-After` asks: about five hours in all, as the twelfth failed try, or any
//! refusal retrying won't change, fails the row. A row whose connection was turned off, or
//! whose event no longer needs anyone, is dropped unsent and leaves no trace. Finished rows
//! are kept 30 days for the connection list, then pruned.

use std::time::Duration;

use sqlx::{Row, SqlitePool};
use tokio::sync::Notify;

use crate::auth::now_unix;

use super::deliver::{deliver, DeliverError};
use super::event::Event;
use super::render::render;
use super::store::get_connection;
use super::NotifyError;

/// How many tries a notification gets before it is marked failed.
pub const MAX_ATTEMPTS: i64 = 12;

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

static KICK: Notify = Notify::const_new();

/// What one drain pass did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Drained {
    pub delivered: usize,
    /// Refused or unanswered, and due again later.
    pub retrying: usize,
    pub failed: usize,
    /// Not sent: the connection was turned off, or the event no longer needs anyone.
    pub dropped: usize,
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
    Dropped,
}

impl Outcome {
    /// A retry on the last try allowed is a failure.
    fn capped(self, attempts: i64) -> Self {
        match self {
            Self::Retry { message, .. } if attempts >= MAX_ATTEMPTS => Self::Failed(message),
            other => other,
        }
    }
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

/// Send each queued notification that is due, up to a batch, one at a time. The links are
/// built from the public URL in effect now, not when the event was queued. A row whose
/// claim or record fails is logged and left to its lease, and the pass goes on.
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
        let claimed = match claim(pool, id).await {
            Ok(Some(claimed)) => claimed,
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(%error, delivery = id, "claim a queued notification");
                continue;
            }
        };
        let outcome = send(pool, client, &claimed, public_url.as_deref())
            .await
            .capped(claimed.attempts);
        let count = match &outcome {
            Outcome::Delivered => &mut drained.delivered,
            Outcome::Retry { .. } => &mut drained.retrying,
            Outcome::Failed(_) => &mut drained.failed,
            Outcome::Dropped => &mut drained.dropped,
        };
        match record(pool, &claimed, outcome).await {
            Ok(()) => *count += 1,
            Err(error) => tracing::warn!(%error, delivery = id, "record a notification's send"),
        }
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

/// Render the claimed row for its connection as it is now, and send it, unless nobody
/// needs it any more.
async fn send(
    pool: &SqlitePool,
    client: &reqwest::Client,
    claimed: &Claimed,
    public_url: Option<&str>,
) -> Outcome {
    let connection = match get_connection(pool, claimed.connection_id).await {
        Ok(connection) if connection.enabled => connection,
        // Turned off on purpose; a deleted connection took its rows with it.
        Ok(_) | Err(NotifyError::NotFound) => return Outcome::Dropped,
        Err(error) => {
            tracing::warn!(%error, "read a notification connection");
            return retry("the connection could not be read");
        }
    };
    let Some(event) = Event::from_stored(&claimed.event, &claimed.payload) else {
        return Outcome::Failed("the queued notification could not be read".to_string());
    };
    match event.still_current(pool).await {
        Ok(true) => {}
        Ok(false) => return Outcome::Dropped,
        Err(error) => {
            tracing::warn!(%error, "check a notification is still needed");
            return retry("could not check the notification is still needed");
        }
    }
    // Only claims a crash cut short count past the cap: a row that brings its sender down
    // every time would otherwise be sent forever.
    if claimed.attempts > MAX_ATTEMPTS {
        return Outcome::Failed(format!("gave up after {} tries", claimed.attempts - 1));
    }
    match deliver(client, render(&connection.settings, &event, public_url)).await {
        Ok(()) => Outcome::Delivered,
        Err(DeliverError::Retry { after, message }) => Outcome::Retry { after, message },
        Err(DeliverError::Permanent { message }) => Outcome::Failed(message),
    }
}

fn retry(message: &str) -> Outcome {
    Outcome::Retry {
        after: None,
        message: message.to_string(),
    }
}

/// Write how the send went: delivered, due again after a backoff, failed for good, or
/// dropped.
async fn record(pool: &SqlitePool, claimed: &Claimed, outcome: Outcome) -> Result<(), NotifyError> {
    let now = now_unix();
    let query = match outcome {
        Outcome::Delivered => sqlx::query(
            "UPDATE notification_deliveries
                SET state = 'delivered', finished_at = ?1, last_error = NULL
              WHERE id = ?2 AND state = 'queued'",
        )
        .bind(now),
        Outcome::Retry { after, message } => {
            let after = after.map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX));
            sqlx::query(
                "UPDATE notification_deliveries SET next_attempt_at = ?1, last_error = ?2
                  WHERE id = ?3 AND state = 'queued'",
            )
            .bind(now.saturating_add(backoff(claimed.attempts).max(after)))
            .bind(message)
        }
        Outcome::Failed(message) => {
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
        Outcome::Dropped => {
            tracing::debug!(
                connection = claimed.connection_id,
                "dropped a notification nobody needs now"
            );
            sqlx::query("DELETE FROM notification_deliveries WHERE id = ?1 AND state = 'queued'")
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
                dropped = d.dropped,
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
