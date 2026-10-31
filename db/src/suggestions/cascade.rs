//! Resolution orchestration for suggestions, mirroring
//! `author_photos::cascade`: a single [`resolve`] entry point the worker drives
//! (via [`crate::worker::Task::ResolveSuggestions`]) plus a [`resolve_with`]
//! that takes injectable Hardcover + image configs for tests.

use std::time::{SystemTime, UNIX_EPOCH};

use futures::future::join_all;
use sqlx::SqlitePool;

use crate::author_photos::{fetch_remote_image_with, RemoteImageConfig};
use crate::suggestions::data::{
    is_fresh, mark_failed, replace_suggestions, suggestion_state, NewSuggestion, SuggestionState,
};
use crate::suggestions::filter::{filter_candidates, Candidate};
use crate::suggestions::hardcover::{
    co_listed_counts, curated_list_ids, fetch_candidates, resolve_book, HardcoverConfig,
};

/// Final strip size — at most 10 survivors are cached.
const FINAL_LIMIT: usize = 10;

/// Max concurrent remote cover fetches while hydrating survivor rows.
const COVER_FETCH_CONCURRENCY: usize = 6;

/// Current unix time in seconds.
fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_secs()).ok())
        .unwrap_or(0)
}

/// Resolve and cache suggestions for `book_uuid`. Reads the effective Hardcover
/// key (settings → env); a missing key is a no-op (the UI shows a connect
/// message). Driven by [`crate::worker::Task::ResolveSuggestions`].
pub async fn resolve(pool: &SqlitePool, book_uuid: &str) -> anyhow::Result<()> {
    let Some(key) = crate::settings::effective_hardcover_api_key(pool).await? else {
        return Ok(());
    };
    resolve_with(
        pool,
        book_uuid,
        &HardcoverConfig::new(key),
        &RemoteImageConfig::default(),
    )
    .await
}

/// [`resolve`] with injectable Hardcover + remote-image configs (for a local
/// `wiremock` in tests). Resolves the library book to a Hardcover book
/// (ISBN-first, title fallback), ranks books co-listed with it, and caches the
/// top 10 with cover bytes. A clean miss writes the `empty` marker; an
/// error marks the book `failed` and is still returned, so the worker logs it.
pub async fn resolve_with(
    pool: &SqlitePool,
    book_uuid: &str,
    config: &HardcoverConfig,
    image_config: &RemoteImageConfig,
) -> anyhow::Result<()> {
    let result = resolve_and_cache(pool, book_uuid, config, image_config).await;
    if result.is_err() {
        if let Err(e) = mark_failed(pool, book_uuid).await {
            tracing::warn!(book_uuid, error = %e, "could not mark a failed suggestions lookup");
        }
    }
    result
}

/// The body of [`resolve_with`]: every error it returns marks the book `failed`.
async fn resolve_and_cache(
    pool: &SqlitePool,
    book_uuid: &str,
    config: &HardcoverConfig,
    image_config: &RemoteImageConfig,
) -> anyhow::Result<()> {
    // A sibling task (serialized behind us on the same resource key) may have
    // already produced a fresh result — skip the network work if so. We do NOT
    // skip on `pending`: that's our own in-flight marker, set by the RPC.
    if let Some((state, at)) = suggestion_state(pool, book_uuid).await? {
        if is_fresh(state, at, now_secs()) {
            return Ok(());
        }
    }

    let Some(book) = crate::get_book_by_uuid(pool, book_uuid).await? else {
        // Book vanished (reindex/ghost) — nothing to resolve.
        return Ok(());
    };
    let title = book.title.clone().unwrap_or_default();
    let author = book.creators.first().map(|c| c.name.clone());
    let isbns = extract_isbns(&book);

    // Resolve the library book to a Hardcover book.
    let Some(resolved) = resolve_book(config, &isbns, &title, author.as_deref()).await? else {
        // Hardcover has no matching book — recorded until the empty marker goes stale.
        replace_suggestions(pool, book_uuid, &[], SuggestionState::Empty).await?;
        return Ok(());
    };

    // Collect curated lists → rank co-listed books → hydrate the deep pool.
    let list_ids = curated_list_ids(config, resolved.id).await?;
    let ranked = co_listed_counts(config, &list_ids, resolved.id).await?;
    let candidates = fetch_candidates(config, &ranked).await?;

    // Filter to different-author / different-series / entry-point survivors.
    let survivors = filter_candidates(
        &candidates,
        &resolved.author_names,
        resolved.series.as_deref(),
        FINAL_LIMIT,
    );

    // Build cache rows, fetching cover bytes best-effort (a cover miss must not
    // drop the suggestion — `Cover` falls back to a typographic plate).
    let covers = fetch_covers_bounded(&survivors, image_config).await;

    let mut rows: Vec<NewSuggestion> = Vec::with_capacity(survivors.len());
    for (c, cover) in survivors.into_iter().zip(covers) {
        // Persist a cover only when the fetch returned real bytes. An empty
        // body (e.g. a 200 with no payload) would set `cover_bytes != NULL` —
        // making `get_suggestions` report `has_cover = true` while the cover
        // endpoint serves a 404 (it rejects empty bytes). Treat empty as none.
        let (cover_mime, cover_bytes) = match cover {
            Some((mime, bytes)) if !bytes.is_empty() => (Some(mime), Some(bytes)),
            _ => (None, None),
        };
        rows.push(NewSuggestion {
            hardcover_id: c.hardcover_id,
            hardcover_slug: c.slug,
            title: c.title,
            author: c.author,
            list_count: c.list_count,
            cover_mime,
            cover_bytes,
        });
    }

    let state = if rows.is_empty() {
        SuggestionState::Empty
    } else {
        SuggestionState::Resolved
    };
    replace_suggestions(pool, book_uuid, &rows, state).await?;
    Ok(())
}

/// Fetch cover bytes for every survivor with bounded concurrency (at most
/// `COVER_FETCH_CONCURRENCY` in flight at once, chunk by chunk), preserving
/// `survivors`' order — the list's already-ranked order becomes the
/// persisted `rank` in `insert_suggestion_rows`.
async fn fetch_covers_bounded(
    survivors: &[Candidate],
    image_config: &RemoteImageConfig,
) -> Vec<Option<(String, Vec<u8>)>> {
    let mut covers: Vec<Option<(String, Vec<u8>)>> = Vec::with_capacity(survivors.len());
    for chunk in survivors.chunks(COVER_FETCH_CONCURRENCY) {
        covers.extend(join_all(chunk.iter().map(|c| fetch_cover(c, image_config))).await);
    }
    covers
}

/// Best-effort remote cover fetch for one candidate. `None` for a candidate
/// with no cover URL, or when the fetch itself fails (a cover miss must not
/// drop the suggestion — the frontend falls back to a typographic plate).
async fn fetch_cover(
    candidate: &Candidate,
    image_config: &RemoteImageConfig,
) -> Option<(String, Vec<u8>)> {
    let url = candidate.cover_url.as_deref()?;
    fetch_remote_image_with(url, image_config).await.ok()
}

/// Pull candidate ISBNs from a book: its `isbn13` / `isbn10` fields first (an
/// edit's value wins), then its identifiers. Identifiers count when their scheme
/// names ISBN or the value *looks* like a 10/13-digit ISBN (covers the common
/// `scheme = "unknown"` case). Hyphens/spaces stripped.
pub(crate) fn extract_isbns(book: &omnibus_shared::EbookMetadata) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for isbn in [book.isbn13.as_deref(), book.isbn10.as_deref()]
        .into_iter()
        .flatten()
    {
        push_isbn(&mut out, isbn);
    }
    for ident in &book.identifiers {
        let scheme_is_isbn = ident
            .scheme
            .as_deref()
            .map(|s| s.to_lowercase().contains("isbn"))
            .unwrap_or(false);
        if scheme_is_isbn || looks_like_isbn(&ident.value) {
            push_isbn(&mut out, &ident.value);
        }
    }
    out
}

/// Digits and `X`/`x` only, so `978-0-13-468599-1` reads as `9780134685991`.
fn clean_isbn(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x')
        .collect()
}

fn looks_like_isbn(raw: &str) -> bool {
    matches!(clean_isbn(raw).len(), 10 | 13)
}

/// Append `raw`, cleaned, unless it cleans to nothing or is already listed.
fn push_isbn(out: &mut Vec<String>, raw: &str) {
    let cleaned = clean_isbn(raw);
    if !cleaned.is_empty() && !out.contains(&cleaned) {
        out.push(cleaned);
    }
}
