//! The task that hands a picked version to the download client and follows it. Each pass
//! sends due removals first, then adds what was picked, then reads every unfinished
//! download; all request state lives in the table, so a restart picks up where it stopped.
//! The client is asked by tag, never by hash, and its answers are judged by [`judge`].

use std::time::Duration;

use sqlx::SqlitePool;

use super::clients::{client_for, DownloadClient, TorrentStatus};
use super::store::{self, RequestError, RequestRow};
use super::ConnectionError;

/// How long a download's bytes may sit still before it counts as stopped. A fixed 12 hours
/// for now; it may become an admin setting.
pub const STALL_SECS: i64 = 12 * 3600;

/// How long the client may fail to answer before every download waiting on it is stopped.
const UNREACHABLE_SECS: i64 = 600;

/// How long a link the client is still fetching may stay unseen before it counts as gone.
const APPEAR_SECS: i64 = 600;

/// The pause between passes while something needs watching, and while nothing does.
const BUSY_WAIT: Duration = Duration::from_secs(5);
const IDLE_WAIT: Duration = Duration::from_secs(60);

/// qBittorrent's states for a download that has all its data.
const FINISHED_STATES: [&str; 7] = [
    "uploading",
    "stalledUP",
    "queuedUP",
    "forcedUP",
    "pausedUP",
    "stoppedUP",
    "checkingUP",
];

/// Why a pass stopped early: the client failed, or the database did.
#[derive(Debug, thiserror::Error)]
enum PassError {
    #[error(transparent)]
    Client(#[from] ConnectionError),
    #[error(transparent)]
    Db(#[from] RequestError),
}

/// What one read of a download means for its request.
#[derive(Debug, PartialEq)]
enum Verdict {
    Wait,
    Progress(f64),
    Done,
    Stopped(&'static str),
}

/// Read the connection settings and run one pass; returns how long to wait for the next.
/// With no client set up there is nothing to do, and nothing changes.
pub async fn poll_tick(pool: &SqlitePool, failing_since: &mut Option<i64>) -> Duration {
    let config = match crate::effective_requests_config(pool).await {
        Ok(config) => config,
        Err(e) => {
            tracing::warn!(error = %e, "read the request connections");
            return IDLE_WAIT;
        }
    };
    let client = match client_for(&config) {
        Ok(client) => client,
        Err(ConnectionError::NotConfigured) => return IDLE_WAIT,
        Err(e) => {
            tracing::warn!(error = %e, "build the download client");
            return IDLE_WAIT;
        }
    };
    let category = &config.download_client_category;
    match poll_once(pool, &client, category, store::unix_now(), failing_since).await {
        Ok(true) => BUSY_WAIT,
        Ok(false) => IDLE_WAIT,
        Err(e) => {
            tracing::error!(error = %e, "request poller could not read the table");
            IDLE_WAIT
        }
    }
}

/// One pass at time `now`; true when something still needs watching. A client that fails
/// changes nothing until it has failed for [`UNREACHABLE_SECS`] running, tracked in
/// `failing_since`.
// shortcut: the failure clock is in memory, so a restart restarts the ten minutes; persist it if restarts mid-outage matter.
pub async fn poll_once(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    category: &str,
    now: i64,
    failing_since: &mut Option<i64>,
) -> Result<bool, RequestError> {
    match pass(pool, client, category, now).await {
        Ok(()) => *failing_since = None,
        Err(PassError::Db(e)) => return Err(e),
        Err(PassError::Client(e)) => {
            if failing_since.is_none() {
                tracing::warn!(error = %e, "download client");
            }
            let since = *failing_since.get_or_insert(now);
            if now - since >= UNREACHABLE_SECS {
                stop_waiting(pool).await?;
            }
        }
    }
    store::has_download_work(pool).await
}

async fn pass(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    category: &str,
    now: i64,
) -> Result<(), PassError> {
    remove_due(pool, client, now).await?;
    add_picked(pool, client, category, now).await?;
    follow_downloads(pool, client, now).await
}

/// Tell the client to drop each download whose undo grace has passed, files and all.
async fn remove_due(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    now: i64,
) -> Result<(), PassError> {
    for row in store::due_removals(pool, now).await? {
        if let Some(tag) = &row.client_tag {
            client.remove(tag, true).await?;
        }
        store::finish_removal(pool, row.id, now).await?;
    }
    Ok(())
}

/// Start the download of every picked version the client does not already have.
async fn add_picked(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    category: &str,
    now: i64,
) -> Result<(), PassError> {
    for row in store::awaiting_add(pool).await? {
        let Some((tag, link)) = store::begin_download(pool, row.id).await? else {
            continue;
        };
        if client.status(&tag).await?.is_none() {
            client.add(&link, category, &tag).await?;
        }
        store::mark_on_its_way(pool, row.id, now).await?;
    }
    Ok(())
}

async fn follow_downloads(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    now: i64,
) -> Result<(), PassError> {
    for row in store::downloading(pool).await? {
        let Some(tag) = row.client_tag.as_deref() else {
            continue;
        };
        let status = client.status(tag).await?;
        match judge(&row, status.as_ref(), now) {
            Verdict::Wait => {}
            Verdict::Progress(p) => store::record_progress(pool, row.id, p, now).await?,
            Verdict::Done => store::record_progress(pool, row.id, 1.0, now).await?,
            Verdict::Stopped(why) => store::mark_stopped(pool, row.id, why).await?,
        }
    }
    Ok(())
}

/// What the client's answer for `row`'s download (`None`: it has none) means at `now`.
fn judge(row: &RequestRow, status: Option<&TorrentStatus>, now: i64) -> Verdict {
    let idle_secs = now - row.moved_at.unwrap_or(now);
    let Some(status) = status else {
        // A link the client fetches on its own can take a while to show up as a download.
        let seen = row.progress.is_some();
        return if seen || idle_secs > APPEAR_SECS {
            Verdict::Stopped("the download client no longer has it")
        } else {
            Verdict::Wait
        };
    };
    if matches!(status.state.as_str(), "error" | "missingFiles") {
        return Verdict::Stopped("the download client reports an error");
    }
    if status.progress >= 1.0 || FINISHED_STATES.contains(&status.state.as_str()) {
        return Verdict::Done;
    }
    if row.progress.is_none_or(|p| status.progress > p) {
        return Verdict::Progress(status.progress);
    }
    if idle_secs > STALL_SECS {
        return Verdict::Stopped("no data has arrived for a long while");
    }
    Verdict::Wait
}

/// The client has been out of reach too long: stop every request waiting on it.
async fn stop_waiting(pool: &SqlitePool) -> Result<(), RequestError> {
    let waiting = store::awaiting_add(pool)
        .await?
        .into_iter()
        .chain(store::downloading(pool).await?);
    for row in waiting {
        let why = "the download client could not be reached for ten minutes";
        store::mark_stopped(pool, row.id, why).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
