//! Book reviews: read one book's reviews, patch your own, delete it. Mobile
//! uses the analogous REST routes in `server::backend::reviews`.

use dioxus::fullstack::post;
use dioxus::prelude::*;
#[cfg(feature = "server")]
use omnibus_db as db;
use omnibus_shared::{BookReviews, Review, ReviewPatch};

#[cfg(feature = "server")]
use super::{internal_rpc_error, AuthUser, PoolExt};

/// Your review of a book, the other readers' reviews and the summary.
#[post("/api/rpc/reviews/get", pool: PoolExt, user: AuthUser)]
pub async fn rpc_get_book_reviews(uuid: String) -> Result<BookReviews> {
    match db::reviews::get_book_reviews(&pool.0, user.id, &uuid).await {
        Ok(reviews) => Ok(reviews),
        Err(db::reviews::ReviewError::BookNotFound) => {
            Err(ServerFnError::new("book not found").into())
        }
        Err(db::reviews::ReviewError::Sqlx(e)) => {
            Err(internal_rpc_error("get book reviews", e).into())
        }
    }
}

/// Patch your review of a book field by field. `Ok(None)` when the patch left
/// it empty, which deletes it.
#[post("/api/rpc/reviews/update", pool: PoolExt, user: AuthUser)]
pub async fn rpc_update_review(uuid: String, patch: ReviewPatch) -> Result<Option<Review>> {
    if let Err(msg) = patch.validate() {
        return Err(ServerFnError::new(msg).into());
    }
    match db::reviews::update_review(&pool.0, user.id, &uuid, &patch).await {
        Ok(review) => Ok(review),
        Err(db::reviews::ReviewError::BookNotFound) => {
            Err(ServerFnError::new("book not found").into())
        }
        Err(db::reviews::ReviewError::Sqlx(e)) => {
            Err(internal_rpc_error("update review", e).into())
        }
    }
}

/// Delete your whole review of a book, notes included. A no-op when absent.
#[post("/api/rpc/reviews/delete", pool: PoolExt, user: AuthUser)]
pub async fn rpc_delete_review(uuid: String) -> Result<()> {
    Ok(db::reviews::delete_review(&pool.0, user.id, &uuid)
        .await
        .map_err(|e| internal_rpc_error("delete review", e))?)
}
