//! Book-review transport: one book's reviews, a field-level patch of your own,
//! and its delete. Web/SSR call the `rpc_*_review*` server functions. Mobile
//! reads `/api/reviews/{uuid}` through the replica and queues a write the
//! server can't be reached for (rule 08); a write for a book whose review
//! writes are still queued joins them rather than landing ahead of them, since
//! their replay would then undo it.

use omnibus_shared::{BookReviews, Review, ReviewPatch};

#[cfg(not(feature = "mobile"))]
use super::note_server_fn_err;
use super::DataError;
#[cfg(feature = "mobile")]
use super::{drain_error, http_client, note_status, with_bearer};
#[cfg(feature = "mobile")]
use crate::offline::{cache, outbox, sync};

/// GET `/api/reviews/{uuid}` — your review, the other readers' and the
/// summary. Cache-first, so the section draws from the replica offline.
#[cfg(feature = "mobile")]
pub async fn get_book_reviews(server_url: &str, uuid: &str) -> Result<BookReviews, DataError> {
    let url = server_url.to_string();
    let uuid = uuid.to_string();
    cache::read_through(cache::keys::reviews(&uuid), async move {
        get_book_reviews_online(&url, &uuid).await
    })
    .await
}

/// Native HTTP transport for [`get_book_reviews`].
#[cfg(feature = "mobile")]
pub(crate) async fn get_book_reviews_online(
    server_url: &str,
    uuid: &str,
) -> Result<BookReviews, DataError> {
    let url = format!("{server_url}/api/reviews/{uuid}");
    let response = with_bearer(http_client().get(&url)).send().await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<BookReviews>().await?)
}

/// Re-read a book's reviews from the server after a write moved the household,
/// a failure staying an error. While offline, or while a write to your review
/// of it is queued, the server's figures would predate that write: it answers
/// [`DataError::Offline`] without asking, so the section marks them stale.
#[cfg(feature = "mobile")]
pub async fn refresh_book_reviews(server_url: &str, uuid: &str) -> Result<BookReviews, DataError> {
    if sync::is_offline() || outbox::review_queued(uuid).await {
        return Err(DataError::Offline);
    }
    let result = get_book_reviews_online(server_url, uuid).await;
    match &result {
        Ok(reviews) => {
            sync::note_online();
            cache::put_json(&cache::keys::reviews(uuid), reviews);
        }
        Err(e) if sync::is_offline_error(e) => sync::note_offline(),
        Err(_) => sync::note_online(),
    }
    result
}

/// PATCH `/api/reviews/{uuid}` — `Ok(None)` when the patch emptied the
/// review. Queued offline, merging field by field with the book's queued patch;
/// one the server would refuse is refused here instead, never queued.
#[cfg(feature = "mobile")]
pub async fn update_review(
    server_url: &str,
    uuid: &str,
    patch: ReviewPatch,
) -> Result<Option<Review>, DataError> {
    patch.validate().map_err(DataError::Other)?;
    if outbox::review_queued(uuid).await {
        if let Some(mine) = outbox::queue_update_review(uuid, &patch).await {
            drain_soon();
            return Ok(mine);
        }
    }
    sync::write_through(
        || land_review_patch(server_url, uuid, patch.clone()),
        || outbox::queue_update_review(uuid, &patch),
    )
    .await
}

/// [`update_review_online`], then the replica keeps the server's answer.
#[cfg(feature = "mobile")]
async fn land_review_patch(
    server_url: &str,
    uuid: &str,
    patch: ReviewPatch,
) -> Result<Option<Review>, DataError> {
    let stars = patch.stars.is_some();
    let mine = update_review_online(server_url, uuid, patch).await?;
    outbox::apply::review_landed(uuid, mine.as_ref(), stars).await;
    Ok(mine)
}

/// Native HTTP transport for [`update_review`].
#[cfg(feature = "mobile")]
pub(crate) async fn update_review_online(
    server_url: &str,
    uuid: &str,
    patch: ReviewPatch,
) -> Result<Option<Review>, DataError> {
    let url = format!("{server_url}/api/reviews/{uuid}");
    let response = with_bearer(http_client().patch(&url).json(&patch))
        .send()
        .await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<Option<Review>>().await?)
}

/// DELETE `/api/reviews/{uuid}` — your stars, text and notes together.
/// Queued offline, where it supersedes the book's queued patch.
#[cfg(feature = "mobile")]
pub async fn delete_review(server_url: &str, uuid: &str) -> Result<(), DataError> {
    if outbox::review_queued(uuid).await && outbox::queue_delete_review(uuid).await {
        drain_soon();
        return Ok(());
    }
    sync::write_through(
        || land_review_delete(server_url, uuid),
        || async { outbox::queue_delete_review(uuid).await.then_some(()) },
    )
    .await
}

/// [`delete_review_online`], then the replica drops your review.
#[cfg(feature = "mobile")]
async fn land_review_delete(server_url: &str, uuid: &str) -> Result<(), DataError> {
    delete_review_online(server_url, uuid).await?;
    // The deleted review may have held stars the stats counted.
    outbox::apply::review_landed(uuid, None, true).await;
    Ok(())
}

/// Native HTTP transport for [`delete_review`].
#[cfg(feature = "mobile")]
pub(crate) async fn delete_review_online(server_url: &str, uuid: &str) -> Result<(), DataError> {
    let url = format!("{server_url}/api/reviews/{uuid}");
    let response = with_bearer(http_client().delete(&url)).send().await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(())
}

/// A write that queued behind the book's queued ones while online goes out
/// with them now rather than at the next sync tick.
#[cfg(feature = "mobile")]
fn drain_soon() {
    if !sync::is_offline() {
        sync::request_drain();
    }
}

/// Web/SSR [`get_book_reviews`] through `rpc_get_book_reviews`.
#[cfg(not(feature = "mobile"))]
pub async fn get_book_reviews(_server_url: &str, uuid: &str) -> Result<BookReviews, DataError> {
    crate::rpc::rpc_get_book_reviews(uuid.to_string())
        .await
        .map_err(note_server_fn_err)
}

/// Web/SSR [`refresh_book_reviews`]: every read already goes to the server.
#[cfg(not(feature = "mobile"))]
pub async fn refresh_book_reviews(server_url: &str, uuid: &str) -> Result<BookReviews, DataError> {
    get_book_reviews(server_url, uuid).await
}

/// Web/SSR [`update_review`] through `rpc_update_review`.
#[cfg(not(feature = "mobile"))]
pub async fn update_review(
    _server_url: &str,
    uuid: &str,
    patch: ReviewPatch,
) -> Result<Option<Review>, DataError> {
    crate::rpc::rpc_update_review(uuid.to_string(), patch)
        .await
        .map_err(note_server_fn_err)
}

/// Web/SSR [`delete_review`] through `rpc_delete_review`.
#[cfg(not(feature = "mobile"))]
pub async fn delete_review(_server_url: &str, uuid: &str) -> Result<(), DataError> {
    crate::rpc::rpc_delete_review(uuid.to_string())
        .await
        .map_err(note_server_fn_err)
}

#[cfg(all(test, feature = "mobile"))]
mod tests;
