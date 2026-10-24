//! Server-side book-metadata resolution against the external providers. Two
//! shapes for two questions: the **ladder** ([`search_provider_by_isbn`] /
//! [`search_provider_by_title`]) walks providers in order and returns the first
//! good answer — right for a check-in scan; the **fan-out**
//! ([`search_all_providers`]) asks every configured provider at once, keeping
//! answers attributed and un-collapsed — right for the editor's edition picker.

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
pub use relevance::{filter_and_rank, score_candidate};
pub use search::{search_all_providers, FANOUT_PROVIDER_LIMIT};
pub use throttle::ThrottleTracker;

use omnibus_shared::isbn::{normalize_isbn, IsbnError};
use omnibus_shared::metadata_lookup::{ExternalBookMeta, MetadataProvider};

/// Maximum candidates a title search returns after dedupe. Small on purpose:
/// the picker is a phone-screen list, and a title that needs more than a
/// handful of candidates needs a better query, not a longer page.
pub const SEARCH_LIMIT: usize = 8;

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

/// Search the providers by title text — the scan flow's fallback when the ISBN
/// itself resolved nothing. Same ladder and semantics as
/// [`search_provider_by_isbn`]; `Ok(vec![])` when the providers answered and
/// none matched. Callers validate the query shape
/// (`ScanSearchRequest::validate`) before this is reached.
pub async fn search_provider_by_title(
    config: &MetadataLookupConfig,
    query: &str,
) -> Result<Vec<ExternalBookMeta>, MetadataLookupError> {
    climb(config, &SearchQuery::from_text(query)).await
}

/// Walk the provider ladder until one answers; the first non-empty answer wins.
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
            Ok(found) if !found.is_empty() => {
                narrow_for_check_in(config, rung.provider, found).await
            }
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

/// Narrow a rung's candidates to the check-in payload, resolving an edition for
/// the top one when the whole rung answered with *works* (Hardcover's full-text
/// search). Check-in stores an ISBN per copy, so a candidate without one is
/// unusable. Costs one extra round trip, for the **first** candidate only, and
/// only on a rung that would otherwise contribute nothing.
async fn narrow_for_check_in(
    config: &MetadataLookupConfig,
    provider: MetadataProvider,
    found: Vec<omnibus_shared::metadata_lookup::ProviderEdition>,
) -> anyhow::Result<Vec<ExternalBookMeta>> {
    if provider == MetadataProvider::OpenLibrary {
        return resolve_open_library_editions(config, found).await;
    }
    let handle = found.first().map(|e| e.provider_ref.clone());
    let narrowed: Vec<ExternalBookMeta> = found
        .into_iter()
        .filter_map(|e| ExternalBookMeta::try_from(e).ok())
        .collect();
    if !narrowed.is_empty() {
        return Ok(narrowed);
    }
    let Some(handle) = handle else {
        return Ok(narrowed);
    };
    // First candidate only: a reader at a shelf with a scanner won't wait on a
    // lookup per result.
    let resolved = match providers::by_ref(provider, config, &handle).await {
        Ok(Some(detail)) => ExternalBookMeta::try_from(detail)
            .map(|meta| vec![meta])
            .unwrap_or_default(),
        Ok(None) => Vec::new(),
        Err(e) => {
            // Best-effort: this is a *recovery* from a rung that already had
            // nothing usable, so its failure is that same miss, not a new one.
            tracing::warn!("{provider:?} edition resolve failed: {e:#}");
            Vec::new()
        }
    };
    Ok(resolved)
}

/// Open Library's title search answers *works*, whose `isbn` list spans every
/// printing, so the ISBN a doc offers can be a Turkish paperback's. Each work
/// is resolved to one real edition, all concurrently; a work whose editions
/// carry no ISBN, or whose editions can't be read, is dropped rather than
/// filed under that unrelated ISBN. Candidates that already name an edition
/// (an ISBN lookup's) pass through. `Err` when nothing resolved and a lookup
/// failed or Open Library is cooling down, so an outage never reads as a miss.
async fn resolve_open_library_editions(
    config: &MetadataLookupConfig,
    found: Vec<omnibus_shared::metadata_lookup::ProviderEdition>,
) -> anyhow::Result<Vec<ExternalBookMeta>> {
    let throttled = config
        .throttle
        .remaining(MetadataProvider::OpenLibrary)
        .is_some();
    let resolved = futures::future::join_all(found.into_iter().map(|mut candidate| async move {
        if !candidate.provider_ref.starts_with("/works/") {
            return Ok(ExternalBookMeta::try_from(candidate).ok());
        }
        if throttled {
            anyhow::bail!("Open Library is rate-limited");
        }
        let edition =
            match providers::openlibrary::work_edition(config, &candidate.provider_ref).await {
                Ok(Some(edition)) => edition,
                // The work has no printing with an ISBN to file.
                Ok(None) => return Ok(None),
                Err(e) => {
                    providers::note_throttle(config, MetadataProvider::OpenLibrary, &e);
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
    }))
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
