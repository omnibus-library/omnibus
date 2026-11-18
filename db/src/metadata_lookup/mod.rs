//! Server-side book-metadata resolution against the external providers. Three
//! shapes for three questions: the **ladder** ([`search_provider_by_isbn`])
//! walks providers in order and returns the first good answer, right for a
//! scanned barcode; the **title search** ([`search_provider_by_title`]) asks
//! every provider at once, ranks the merged pile and resolves one edition per
//! row it returns, right for a reader typing a title; the **fan-out**
//! ([`search_all_providers`]) keeps answers attributed and un-collapsed, right
//! for the editor's edition picker.

mod config;
pub(crate) mod cover;
mod hydrate;
mod providers;
pub mod query;
mod relevance;
mod search;
pub mod throttle;

#[cfg(test)]
mod tests;

pub use config::{MetadataLookupConfig, ProviderKeys};
pub use cover::{
    cover_image_config_for, fetch_provider_cover, provider_cover_image_config, MAX_COVER_REDIRECTS,
};
pub use hydrate::hydrate_edition;
pub use providers::{all_cover_hosts, catalog, cover_hosts, openlibrary_enrich, OlEnrichment};
pub use query::SearchQuery;
pub use relevance::{filter_and_rank, score_candidate, score_title_match, MIN_RELEVANCE_SCORE};
pub use search::{search_all_providers, FANOUT_PROVIDER_LIMIT};
pub use throttle::ThrottleTracker;

use omnibus_shared::isbn::{normalize_isbn, IsbnError};
use omnibus_shared::metadata_lookup::{ExternalBookMeta, ProviderEdition, ProviderSearchStatus};

/// Max rows a title search returns, and the page size asked of each provider upstream.
pub const SEARCH_LIMIT: usize = 20;

/// Errors from a provider search.
#[derive(Debug, thiserror::Error)]
pub enum MetadataLookupError {
    /// The input ISBN failed validation (bad length, chars, or check digit).
    #[error(transparent)]
    Isbn(#[from] IsbnError),
    /// No provider could be asked. Distinct from a clean miss, which is an empty
    /// answer, not an error. The message is the caller-facing sentence, not the
    /// provider's wording (usually Google Books' anonymous 429 quota, not an Omnibus
    /// bug); the provider error stays on the source chain for the log. It names no
    /// way forward: the web dialog has no manual-entry route.
    #[error("metadata lookup is temporarily unavailable — try again later")]
    Provider(#[from] anyhow::Error),
}

/// Resolve an ISBN to book metadata, asking each configured provider in turn.
/// A bad ISBN fails first with [`MetadataLookupError::Isbn`]. `Ok(None)` means
/// the providers answered and none knew the book, which sends the UI to manual
/// entry or a title search. Series and first-publish year the provider left
/// empty are filled from Open Library ([`openlibrary_enrich`]).
pub async fn search_provider_by_isbn(
    config: &MetadataLookupConfig,
    raw_isbn: &str,
) -> Result<Option<ExternalBookMeta>, MetadataLookupError> {
    let isbn13 = normalize_isbn(raw_isbn)?;

    let query = SearchQuery {
        isbn13: Some(isbn13.clone()),
        ..SearchQuery::default()
    };
    let (found, enrichment) = tokio::join!(
        climb(config, &query),
        providers::openlibrary_enrich(config, &isbn13)
    );
    Ok(found?.into_iter().next().map(|mut meta| {
        meta.series = meta.series.or(enrichment.series);
        meta.first_publish_year = meta.first_publish_year.or(enrichment.first_publish_year);
        meta
    }))
}

/// Search the providers by title text, the scan flow's fallback when the ISBN
/// itself resolved nothing. Asks every configured provider once, ranks the
/// merged answers (relevance, authored, most read), and resolves an edition for
/// each of the top [`SEARCH_LIMIT`] only. `Ok(vec![])` when the providers
/// answered and none matched; `Err` only when nothing came back and the last
/// catalog (the ladder's terminal provider) failed or was cooling down, so a
/// Hardcover outage never turns a miss into an error. Callers validate the
/// query shape (`ScanSearchRequest::validate`) before this is reached.
pub async fn search_provider_by_title(
    config: &MetadataLookupConfig,
    query: &str,
) -> Result<Vec<ExternalBookMeta>, MetadataLookupError> {
    let searched = search_all_providers(config, &SearchQuery::from_text(query), None).await;
    let rows = relevance::rank_merged(searched.editions, SEARCH_LIMIT);
    let resolved = futures::future::join_all(rows.into_iter().map(|row| async move {
        let source = row.source;
        (source, resolve_for_check_in(config, row).await)
    }))
    .await;

    let terminal = providers::ladder(config)
        .into_iter()
        .find(|rung| rung.terminal)
        .map(|rung| rung.provider);
    let mut metas = Vec::new();
    let mut terminal_error = None;
    for (source, outcome) in resolved {
        match outcome {
            Ok(meta) => metas.extend(meta),
            Err(e) if Some(source) == terminal => terminal_error = terminal_error.or(Some(e)),
            Err(_) => {}
        }
    }
    let metas = dedupe_by_isbn(metas);
    if !metas.is_empty() {
        return Ok(metas);
    }
    let search_error = searched
        .sources
        .into_iter()
        .filter(|row| Some(row.provider) == terminal)
        .find_map(|row| match row.status {
            ProviderSearchStatus::Failed { message } => Some(anyhow::anyhow!(message)),
            ProviderSearchStatus::Throttled { retry_after_secs } => Some(anyhow::anyhow!(
                "{:?} is rate-limited; retry in {retry_after_secs}s",
                row.provider
            )),
            _ => None,
        });
    match terminal_error.or(search_error) {
        Some(e) => Err(MetadataLookupError::Provider(e)),
        None => Ok(Vec::new()),
    }
}

/// Walk the provider ladder (the ISBN lookup's) until one answers; the first
/// non-empty answer wins.
/// A failed rung is skipped, since a provider being down says nothing about
/// whether the book exists, but if the walk ends empty and the terminal rung
/// failed, that error surfaces instead of an unreliable "not found". A rung in
/// a rate-limit cooldown is skipped without a request and counts as failed.
async fn climb(
    config: &MetadataLookupConfig,
    query: &SearchQuery,
) -> Result<Vec<ExternalBookMeta>, MetadataLookupError> {
    let mut terminal_error: Option<anyhow::Error> = None;

    for rung in providers::ladder(config) {
        if let Some(remaining) = config.throttle.remaining(rung.provider) {
            let secs = throttle::retry_after_secs(remaining);
            tracing::warn!(
                "{:?} is rate-limited for another {secs}s, skipping rung",
                rung.provider
            );
            if rung.terminal {
                terminal_error = Some(anyhow::anyhow!(
                    "{:?} is rate-limited; retry in {secs}s",
                    rung.provider
                ));
            }
            continue;
        }
        // Score every answer before accepting it: Hardcover's full-text search would
        // otherwise hand back whatever a fuzzy engine ranked first as the one confident
        // answer a reader files a physical copy against.
        let answer = match providers::run(rung.provider, config, query)
            .await
            .map(|found| relevance::filter_and_rank(found, query, SEARCH_LIMIT))
        {
            Ok(found) if !found.is_empty() => narrow_for_check_in(config, found).await,
            Ok(_) => Ok(Vec::new()),
            Err(e) => Err(e),
        };
        match answer {
            // The ladder hands callers the frozen check-in payload, not the
            // picker's richer candidate — and a candidate with no ISBN is not
            // something check-in can act on, so it is dropped rather than being
            // given a blank one. `ExternalBookMeta`'s contract (and the iOS
            // decoder that depends on it) stays frozen while the picker's loosens.
            // A rung whose every candidate lacks an ISBN has nothing check-in
            // can use, which is the same as a miss: keep walking.
            Ok(narrowed) if !narrowed.is_empty() => return Ok(dedupe_by_isbn(narrowed)),
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("{:?} lookup failed, trying next: {e:#}", rung.provider);
                if rung.terminal {
                    terminal_error = Some(e);
                }
            }
        }
    }

    match terminal_error {
        Some(e) => Err(MetadataLookupError::Provider(e)),
        None => Ok(Vec::new()),
    }
}

/// Narrow a rung's candidates to the check-in payload, resolving each one with
/// [`resolve_for_check_in`]. `Err` only when nothing resolved and a lookup
/// failed or the provider is cooling down, so an outage never reads as a miss.
async fn narrow_for_check_in(
    config: &MetadataLookupConfig,
    found: Vec<ProviderEdition>,
) -> anyhow::Result<Vec<ExternalBookMeta>> {
    let resolved = futures::future::join_all(
        found
            .into_iter()
            .map(|candidate| resolve_for_check_in(config, candidate)),
    )
    .await;
    let mut metas = Vec::new();
    let mut first_error = None;
    for outcome in resolved {
        match outcome {
            Ok(meta) => metas.extend(meta),
            Err(e) => first_error = first_error.or(Some(e)),
        }
    }
    match first_error {
        Some(e) if metas.is_empty() => Err(e),
        _ => Ok(metas),
    }
}

/// Turn one candidate into the check-in payload, which stores an ISBN per copy.
/// A candidate that already names an edition passes through. An Open Library
/// *work*, whose `isbn` list spans every printing, is resolved to one real
/// edition; any other candidate without an ISBN (Hardcover's) is re-fetched by
/// its handle. `Ok(None)` when there is nothing to file; `Err` when the lookup
/// failed or the provider is cooling down, so an outage never reads as a miss.
async fn resolve_for_check_in(
    config: &MetadataLookupConfig,
    mut candidate: ProviderEdition,
) -> anyhow::Result<Option<ExternalBookMeta>> {
    let is_work = candidate.provider_ref.starts_with("/works/");
    if !is_work && candidate.isbn13.is_some() {
        return Ok(ExternalBookMeta::try_from(candidate).ok());
    }
    if let Some(remaining) = config.throttle.remaining(candidate.source) {
        anyhow::bail!(
            "{:?} is rate-limited; retry in {}s",
            candidate.source,
            throttle::retry_after_secs(remaining)
        );
    }
    if !is_work {
        return match providers::by_ref(candidate.source, config, &candidate.provider_ref).await {
            Ok(detail) => Ok(detail.and_then(|d| ExternalBookMeta::try_from(d).ok())),
            Err(e) => {
                tracing::warn!("{:?} edition resolve failed: {e:#}", candidate.source);
                Err(e)
            }
        };
    }
    let edition = match providers::openlibrary::work_edition(config, &candidate.provider_ref).await
    {
        Ok(Some(edition)) => edition,
        // The work has no printing with an ISBN to file.
        Ok(None) => return Ok(None),
        Err(e) => {
            providers::note_throttle(config, candidate.source, &e);
            tracing::warn!("open library editions lookup failed: {e:#}");
            return Err(e);
        }
    };
    candidate.isbn13 = Some(edition.isbn13);
    candidate.publisher = edition.publisher;
    candidate.pages = edition.pages;
    let Ok(mut meta) = ExternalBookMeta::try_from(candidate) else {
        return Ok(None);
    };
    meta.format = edition.format;
    Ok(Some(meta))
}

/// Drop repeat editions (Google Books in particular answers the same ISBN
/// more than once) and cap the picker's length, keeping first-seen order. A
/// no-op on the ISBN path, which answers with at most one entry.
fn dedupe_by_isbn(results: Vec<ExternalBookMeta>) -> Vec<ExternalBookMeta> {
    let mut seen = std::collections::HashSet::new();
    results
        .into_iter()
        .filter(|m| seen.insert(m.isbn13.clone()))
        .take(SEARCH_LIMIT)
        .collect()
}
