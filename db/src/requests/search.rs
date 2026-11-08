//! Runs the search behind a `looking` request: asks Prowlarr for the book's title and first
//! author, ranks what comes back and records the outcome. A request ends `choose` when
//! some version survived, else `stuck`; the word the reader sees is the same for both
//! reasons, but the reason and detail (for admins) differ. A Prowlarr that is briefly
//! unreachable or rate limiting is retried for a while before the request gives up.

use std::time::{Duration, Instant};

use omnibus_shared::{RequestState, StuckReason};
use sqlx::SqlitePool;

use super::prowlarr::Prowlarr;
use super::rank::rank;
use super::store::{self, RequestError, SearchOutcome};
use super::ConnectionError;

/// How long a search keeps trying while Prowlarr is unreachable or rate limiting, and how long
/// it waits after the first failure; each later wait doubles, up to [`MAX_WAIT`].
#[derive(Debug, Clone, Copy)]
pub struct Patience {
    /// Counts only the next wait, so the last attempt can run one search timeout past it.
    pub budget: Duration,
    pub first_wait: Duration,
}

impl Patience {
    /// What a reader's search gets: ten minutes, starting with five seconds.
    pub const DEFAULT: Patience = Patience {
        budget: Duration::from_secs(10 * 60),
        first_wait: Duration::from_secs(5),
    };
}

const MAX_WAIT: Duration = Duration::from_secs(60);

/// What one try at the search came to.
enum Attempt {
    Done(SearchOutcome),
    /// Prowlarr could not be asked just now; holds the outcome if no retry is left.
    Transient(SearchOutcome),
}

/// Search for request `id` and record the outcome. Nothing happens for a request that is
/// gone or no longer `looking`. Meant to run as a spawned task.
pub async fn run_search(pool: &SqlitePool, id: i64) -> Result<(), RequestError> {
    run_search_with(pool, id, Patience::DEFAULT).await
}

/// [`run_search`] with the given `patience` for a Prowlarr that cannot be reached. A request
/// cancelled or answered while the search waits to retry is left alone.
pub async fn run_search_with(
    pool: &SqlitePool,
    id: i64,
    patience: Patience,
) -> Result<(), RequestError> {
    let Some(request) = store::get(pool, id).await?.filter(is_looking) else {
        return Ok(());
    };
    let began = Instant::now();
    let mut wait = patience.first_wait;
    let outcome = loop {
        match attempt(pool, &request.book_uuid).await {
            Attempt::Done(outcome) => break outcome,
            Attempt::Transient(outcome) if began.elapsed() + wait > patience.budget => {
                break outcome;
            }
            Attempt::Transient(_) => {
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(MAX_WAIT);
                if !store::get(pool, id).await?.as_ref().is_some_and(is_looking) {
                    return Ok(());
                }
            }
        }
    };
    store::finish_search(pool, id, outcome).await
}

fn is_looking(r: &store::RequestRow) -> bool {
    r.state == RequestState::Looking
}

fn stuck_failed(detail: impl Into<String>) -> SearchOutcome {
    SearchOutcome::Stuck {
        reason: StuckReason::SearchFailed,
        detail: Some(detail.into()),
    }
}

fn failed(detail: impl Into<String>) -> Attempt {
    Attempt::Done(stuck_failed(detail))
}

/// A failed call to Prowlarr: retried when it was only unreachable or rate limiting.
fn search_error(e: ConnectionError) -> Attempt {
    let outcome = stuck_failed(e.to_string());
    match e {
        ConnectionError::Unreachable(_) | ConnectionError::RateLimited => {
            Attempt::Transient(outcome)
        }
        _ => Attempt::Done(outcome),
    }
}

async fn attempt(pool: &SqlitePool, book_uuid: &str) -> Attempt {
    let book = match crate::get_book_by_uuid(pool, book_uuid).await {
        Ok(Some(book)) => book,
        Ok(None) => return failed("the book no longer exists"),
        Err(e) => {
            tracing::warn!(error = %e, "read the requested book");
            return failed("could not read the book");
        }
    };
    let title = book.title.unwrap_or_default();
    let author = book
        .creators
        .first()
        .map(|c| c.name.clone())
        .unwrap_or_default();
    if title.trim().is_empty() {
        return failed("the book has no title");
    }
    let config = match crate::effective_requests_config(pool).await {
        Ok(config) => config,
        Err(e) => {
            tracing::warn!(error = %e, "read the request connections");
            return failed("could not read the settings");
        }
    };
    let prowlarr = match Prowlarr::from_config(&config) {
        Ok(p) => p,
        Err(e) => return failed(e.to_string()),
    };
    let query = format!("{title} {author}");
    let releases = match prowlarr.search(query.trim()).await {
        Ok(releases) => releases,
        Err(e) => return search_error(e),
    };
    let ranked = rank(releases, &title, &author);
    if ranked.iter().all(|r| r.rejected) {
        return Attempt::Done(SearchOutcome::Stuck {
            reason: StuckReason::NotFound,
            detail: failing_indexers(&prowlarr).await,
        });
    }
    Attempt::Done(SearchOutcome::Found(ranked))
}

/// Which indexers Prowlarr has switched off, when it will say; the likeliest reason an
/// empty search came back empty.
async fn failing_indexers(prowlarr: &Prowlarr) -> Option<String> {
    let statuses = prowlarr.indexer_status().await.ok()?;
    let lines: Vec<String> = statuses
        .iter()
        .map(|s| match &s.disabled_till {
            Some(till) => format!("indexer {} disabled until {till}", s.indexer_id),
            None => format!("indexer {} failing", s.indexer_id),
        })
        .collect();
    (!lines.is_empty()).then(|| lines.join("; "))
}

#[cfg(test)]
mod tests;
