//! The task that hands a picked version to the download client and follows it. Each pass
//! claims the cancels whose grace ended and takes out what is on the removal list, then adds
//! what was picked, then reads every unfinished download; a tick then adds the finished ones
//! to the library. All request state lives in the table, so a restart picks up where it
//! stopped. A download is found in the client by its info hash alone, and the client's answers are
//! judged by [`judge`].

use std::sync::Arc;
use std::time::Duration;

use omnibus_shared::{ReleaseProtocol, StuckReason};
use sqlx::SqlitePool;

use crate::settings::RequestsConfig;
use crate::worker::Worker;

use super::clients::{client_for, DownloadClient, TorrentStatus};
use super::import::import_finished;
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

const STOPPED: StuckReason = StuckReason::StoppedMoving;

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
    Stopped(&'static str),
}

/// Read the connection settings, run one pass and import what finished; returns how long to
/// wait for the next. With no client set up there is nothing to do, and nothing changes.
pub async fn poll_tick(
    pool: &SqlitePool,
    worker: &Arc<Worker>,
    failing_since: &mut Option<i64>,
) -> Duration {
    let config = match crate::effective_requests_config(pool).await {
        Ok(config) => config,
        Err(e) => {
            tracing::warn!(error = %e, "read the request connections");
            return IDLE_WAIT;
        }
    };
    let client = match client_for(&config) {
        Ok(client) => client,
        Err(ConnectionError::NotConfigured) => {
            // Nothing can move without a client; a download already on its way is not coming.
            if let Err(e) = stop_downloading(pool, "no download client configured").await {
                tracing::error!(error = %e, "request poller could not read the table");
            }
            return IDLE_WAIT;
        }
        Err(e) => {
            tracing::warn!(error = %e, "build the download client");
            return IDLE_WAIT;
        }
    };
    tick_with(pool, worker, &client, &config, failing_since).await
}

/// [`poll_tick`] once the connections are read and the client built: a pass, then the import
/// of what finished.
pub async fn tick_with(
    pool: &SqlitePool,
    worker: &Arc<Worker>,
    client: &impl DownloadClient,
    config: &RequestsConfig,
    failing_since: &mut Option<i64>,
) -> Duration {
    let category = &config.download_client_category;
    let busy = match poll_once(pool, client, category, store::unix_now(), failing_since).await {
        Ok(busy) => busy,
        Err(e) => {
            tracing::error!(error = %e, "request poller could not read the table");
            return IDLE_WAIT;
        }
    };
    let import_waiting = match import_finished(pool, client, worker, config).await {
        Ok(waiting) => waiting,
        Err(e) => {
            tracing::error!(error = %e, "request poller could not read the table");
            return IDLE_WAIT;
        }
    };
    if busy || import_waiting {
        BUSY_WAIT
    } else {
        IDLE_WAIT
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
                stop_downloading(
                    pool,
                    "the download client could not be reached for ten minutes",
                )
                .await?;
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
    store::claim_due_cancels(pool, now).await?;
    resolve_legacy_tags(pool, client).await?;
    // Before the removals, so a swap to another version of the same release keeps its torrent.
    add_picked(pool, client, category, now).await?;
    remove_pending(pool, client, now).await?;
    follow_downloads(pool, client, now).await
}

/// A refusal tied to one request's link or request rather than to the client being down.
fn refused_one(e: &ConnectionError) -> bool {
    matches!(e, ConnectionError::Rejected(_) | ConnectionError::BadUrl(_))
}

/// Take each download on the removal list out of the client, files and all. A job the client
/// has not shown yet may still be being fetched, so its hash stays until it has been seen and
/// removed, or [`APPEAR_SECS`] have passed without it.
async fn remove_pending(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    now: i64,
) -> Result<(), PassError> {
    for row in store::pending_removals(pool).await? {
        let Some(hash) = row.remove_hash.as_deref() else {
            continue;
        };
        // Another request may download the very same release; it keeps the torrent.
        if store::hash_in_use(pool, hash, row.id).await? {
            store::finish_removal(pool, row.id, hash).await?;
            continue;
        }
        if client.status(hash).await?.is_some() {
            store::mark_removal_seen(pool, row.id, hash).await?;
            match client.remove(hash, true).await {
                Err(e) if refused_one(&e) => tracing::warn!(error = %e, "remove a download"),
                other => other?,
            }
        } else if row
            .remove_since
            .is_none_or(|since| now - since > APPEAR_SECS)
        {
            store::finish_removal(pool, row.id, hash).await?;
        }
    }
    Ok(())
}

/// Find the download an earlier version tagged for each request that still carries the tag:
/// it is one Omnibus added, now known by hash. A request on its way whose download the client
/// has lost is stopped; any other just forgets the tag.
async fn resolve_legacy_tags(
    pool: &SqlitePool,
    client: &impl DownloadClient,
) -> Result<(), PassError> {
    for row in store::with_legacy_tag(pool).await? {
        let Some(tag) = row.legacy_tag.as_deref() else {
            continue;
        };
        let hash = client.hash_for_tag(tag).await?;
        store::resolve_legacy_tag(pool, row.id, tag, hash.as_deref()).await?;
        if hash.is_none() && row.state == omnibus_shared::RequestState::OnItsWay {
            let why = "the download client no longer has it";
            store::mark_stuck(pool, row.id, row.chosen_result_id, STOPPED, why).await?;
        }
    }
    Ok(())
}

/// Hand every picked version to the client, adopting a torrent it already holds that this
/// request has not recorded as its own. Ownership is written before the client is given the
/// release, so a cancel or a crash meanwhile still finds the torrent to remove. A link the
/// client refuses stops that request alone.
async fn add_picked(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    category: &str,
    now: i64,
) -> Result<(), PassError> {
    for row in store::awaiting_add(pool).await? {
        let Some(link) = store::pick_link(pool, row.id).await? else {
            continue;
        };
        let prepared = match client.prepare(&link).await {
            Ok(prepared) => prepared,
            Err(e) if refused_one(&e) => {
                store::mark_stuck(pool, row.id, row.chosen_result_id, STOPPED, &e.to_string())
                    .await?;
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        let hash = prepared.hash.clone();
        match client.status(&hash).await? {
            // A usenet job that failed would stop this request again at once; clear it to retry.
            Some(found)
                if client.protocol() == ReleaseProtocol::Usenet && found.state == "error" =>
            {
                client.remove(&hash, true).await?;
            }
            Some(_) => {
                // Ours when this request recorded it, or called it off a moment ago.
                let ours = (row.client_hash.as_deref() == Some(hash.as_str())
                    && !row.client_adopted)
                    || row.remove_hash.as_deref() == Some(hash.as_str());
                store::mark_on_its_way(pool, row.id, &hash, !ours, now).await?;
                continue;
            }
            None => {}
        }
        if !store::claim_hash(pool, row.id, &hash).await? {
            continue;
        }
        match client.add(prepared, category).await {
            Ok(()) => {}
            Err(e) if refused_one(&e) => {
                store::release_claim(pool, row.id, &hash).await?;
                store::mark_stuck(pool, row.id, row.chosen_result_id, STOPPED, &e.to_string())
                    .await?;
                continue;
            }
            Err(e) => return Err(e.into()),
        }
        store::mark_on_its_way(pool, row.id, &hash, false, now).await?;
    }
    Ok(())
}

async fn follow_downloads(
    pool: &SqlitePool,
    client: &impl DownloadClient,
    now: i64,
) -> Result<(), PassError> {
    for row in store::downloading(pool).await? {
        let Some(hash) = row.client_hash.as_deref() else {
            continue;
        };
        let status = client.status(hash).await?;
        let pick = row.chosen_result_id;
        let done_at = status.as_ref().and_then(|s| expected_done_at(s, now));
        match judge(&row, status.as_ref(), now) {
            Verdict::Wait if done_at != row.expected_done_at => {
                store::record_expected_done_at(pool, row.id, pick, done_at).await?
            }
            Verdict::Wait => {}
            // A finished download's eta is how long it seeds, not how long it has left.
            Verdict::Progress(p) => {
                let done_at = done_at.filter(|_| p < 1.0);
                store::record_progress(pool, row.id, pick, p, now, done_at).await?
            }
            Verdict::Stopped(why) => store::mark_stuck(pool, row.id, pick, STOPPED, why).await?,
        }
    }
    Ok(())
}

/// qBittorrent's `eta` for a download it can't time.
const NO_ETA: i64 = 8_640_000;

/// When the client expects `status`'s download to finish, from `now`; `None` when it can't say.
fn expected_done_at(status: &TorrentStatus, now: i64) -> Option<i64> {
    status
        .eta
        .filter(|eta| (0..NO_ETA).contains(eta))
        .map(|eta| now + eta)
}

/// What the client's answer for `row`'s download (`None`: it has none) means at `now`.
fn judge(row: &RequestRow, status: Option<&TorrentStatus>, now: i64) -> Verdict {
    let idle_secs = now - row.moved_at.unwrap_or(now);
    let Some(status) = status else {
        // qBittorrent 5.x adds asynchronously, so a torrent can take a while to show up.
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
        return Verdict::Progress(1.0);
    }
    if row.progress.is_none_or(|p| status.progress > p) {
        return Verdict::Progress(status.progress);
    }
    if idle_secs > STALL_SECS {
        return Verdict::Stopped("no data has arrived for a long while");
    }
    Verdict::Wait
}

/// Stop every download on its way, for `why`. A pick not yet added keeps waiting: it has not
/// failed, and nothing has been given up.
async fn stop_downloading(pool: &SqlitePool, why: &str) -> Result<(), RequestError> {
    for row in store::downloading(pool).await? {
        store::mark_stuck(pool, row.id, row.chosen_result_id, STOPPED, why).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
