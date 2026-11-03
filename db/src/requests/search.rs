//! Runs the search behind a `looking` request: asks Prowlarr for the book's title and first
//! author, ranks what comes back and records the outcome. A request ends `choose` when
//! some version survived, else `stuck`; the word the reader sees is the same for both
//! reasons, but the reason and detail (for admins) differ.

use omnibus_shared::{RequestState, StuckReason};
use sqlx::SqlitePool;

use super::prowlarr::Prowlarr;
use super::rank::rank;
use super::store::{self, RequestError, SearchOutcome};

/// Search for request `id` and record the outcome. Nothing happens for a request that is
/// gone or no longer `looking`. Meant to run as a spawned task.
pub async fn run_search(pool: &SqlitePool, id: i64) -> Result<(), RequestError> {
    let Some(request) = store::get(pool, id)
        .await?
        .filter(|r| r.state == RequestState::Looking)
    else {
        return Ok(());
    };
    let outcome = search_outcome(pool, &request.book_uuid).await;
    store::finish_search(pool, id, outcome).await?;
    Ok(())
}

fn failed(detail: impl Into<String>) -> SearchOutcome {
    SearchOutcome::Stuck {
        reason: StuckReason::SearchFailed,
        detail: Some(detail.into()),
    }
}

async fn search_outcome(pool: &SqlitePool, book_uuid: &str) -> SearchOutcome {
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
        Err(e) => return failed(e.to_string()),
    };
    let ranked = rank(releases, &title, &author);
    if ranked.iter().all(|r| r.rejected) {
        return SearchOutcome::Stuck {
            reason: StuckReason::NotFound,
            detail: failing_indexers(&prowlarr).await,
        };
    }
    SearchOutcome::Found(ranked)
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
