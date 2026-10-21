//! Book-review transport: one book's reviews, a field-level patch of your own,
//! and its delete. Web/SSR call the `rpc_*_review*` server functions; mobile
//! calls `/api/reviews/{uuid}` directly, uncached and never queued, so a write
//! made offline fails rather than pretending to land.

use omnibus_shared::{BookReviews, Review, ReviewPatch};

#[cfg(not(feature = "mobile"))]
use super::note_server_fn_err;
use super::DataError;
#[cfg(feature = "mobile")]
use super::{drain_error, http_client, note_status, with_bearer};

/// GET `/api/reviews/{uuid}` — your review, the other readers' and the summary.
#[cfg(feature = "mobile")]
pub async fn get_book_reviews(server_url: &str, uuid: &str) -> Result<BookReviews, DataError> {
    let url = format!("{server_url}/api/reviews/{uuid}");
    let response = with_bearer(http_client().get(&url)).send().await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<BookReviews>().await?)
}

/// PATCH `/api/reviews/{uuid}` — `Ok(None)` when the patch emptied the review.
#[cfg(feature = "mobile")]
pub async fn update_review(
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
#[cfg(feature = "mobile")]
pub async fn delete_review(server_url: &str, uuid: &str) -> Result<(), DataError> {
    let url = format!("{server_url}/api/reviews/{uuid}");
    let response = with_bearer(http_client().delete(&url)).send().await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(())
}

/// Web/SSR [`get_book_reviews`] through `rpc_get_book_reviews`.
#[cfg(not(feature = "mobile"))]
pub async fn get_book_reviews(_server_url: &str, uuid: &str) -> Result<BookReviews, DataError> {
    crate::rpc::rpc_get_book_reviews(uuid.to_string())
        .await
        .map_err(note_server_fn_err)
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
