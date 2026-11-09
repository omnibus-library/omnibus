//! Runs the search behind a `looking` request: asks Prowlarr for the book's title and first
//! author, ranks what comes back and records the outcome. A request ends `choose` when
//! some version survived, else `stuck`; the word the reader sees is the same for both
//! reasons, but the reason and the detail, which says what was searched and found, differ. A Prowlarr that is briefly
//! unreachable or rate limiting is retried for a while before the request gives up.

use std::time::{Duration, Instant};

use omnibus_shared::{RequestKind, RequestState, StuckReason};
use sqlx::SqlitePool;

use super::prowlarr::Prowlarr;
use super::rank::{rank, Ranked, Rejection};
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
        match attempt(pool, &request.book_uuid, request.kind).await {
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

/// A failed call to Prowlarr, said so that the reader can tell which service it was.
fn prowlarr_says(e: &ConnectionError) -> String {
    match e {
        ConnectionError::NotConfigured => "Prowlarr is not set up yet".to_string(),
        ConnectionError::Unreachable(why) => format!("Prowlarr could not be reached ({why})"),
        ConnectionError::BadApiKey => "Prowlarr rejected the API key".to_string(),
        other => other.to_string(),
    }
}

/// A failed call to Prowlarr: retried when it was only unreachable or rate limiting.
fn search_error(e: ConnectionError) -> Attempt {
    let outcome = stuck_failed(prowlarr_says(&e));
    match e {
        ConnectionError::Unreachable(_) | ConnectionError::RateLimited => {
            Attempt::Transient(outcome)
        }
        _ => Attempt::Done(outcome),
    }
}

async fn attempt(pool: &SqlitePool, book_uuid: &str, kind: RequestKind) -> Attempt {
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
        Err(e) => return failed(prowlarr_says(&e)),
    };
    let query = format!("{title} {author}");
    let releases = match prowlarr.search(query.trim(), kind).await {
        Ok(releases) => releases,
        Err(e) => return search_error(e),
    };
    let ranked = rank(releases, &title, &author, kind);
    if ranked.iter().all(|r| r.rejected) {
        let detail = not_found_detail(query.trim(), &ranked, failing_indexers(&prowlarr).await);
        return Attempt::Done(SearchOutcome::Stuck {
            reason: StuckReason::NotFound,
            detail: Some(detail),
        });
    }
    Attempt::Done(SearchOutcome::Found(ranked))
}

/// What a search that ended `not_found` says for itself: what was asked, how many results
/// came back, why each was dropped, and which indexers were down.
fn not_found_detail(query: &str, ranked: &[Ranked], indexers: Option<String>) -> String {
    let came_back = match ranked.len() {
        0 => "no results came back".to_string(),
        1 => "1 result came back".to_string(),
        n => format!("{n} results came back"),
    };
    let count = |cause| ranked.iter().filter(|r| r.cause == Some(cause)).count();
    let causes = [
        (
            Rejection::Category,
            "was in another category",
            "were in another category",
        ),
        (
            Rejection::Book,
            "didn't match the book's title and author",
            "didn't match the book's title and author",
        ),
        (
            Rejection::Usenet,
            "was a usenet release the download client can't fetch",
            "were usenet releases the download client can't fetch",
        ),
        (
            Rejection::Unusable,
            "had a format, size or seeder count that can't be used",
            "had a format, size or seeder count that can't be used",
        ),
    ];
    let why: Vec<String> = causes
        .iter()
        .filter_map(|&(cause, one, many)| match count(cause) {
            0 => None,
            1 => Some(format!("1 {one}")),
            n => Some(format!("{n} {many}")),
        })
        .collect();
    let mut detail = format!("searched for “{query}”: {came_back}");
    if !why.is_empty() {
        detail.push_str(": ");
        detail.push_str(&why.join(", "));
    }
    if let Some(indexers) = indexers {
        detail.push_str("; ");
        detail.push_str(&indexers);
    }
    detail
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
