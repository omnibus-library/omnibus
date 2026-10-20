//! The stars-only view of [`crate::reviews`], for the older `/api/ratings`
//! routes, their Dioxus server functions and the Kobo `RateBook` ingest. A
//! rating is a review's stars and `rated_at`; setting or clearing one patches
//! only the stars, so text and private notes on the same review survive.

use omnibus_shared::{
    stars_from_half_stars, AttributedRating, RatingRecord, RatingUpdate, Review, ReviewPatch,
};
use sqlx::{Row, SqlitePool};

use crate::resolve_canonical_book_uuid;
use crate::reviews::{self, ReviewError};

/// Hard cap on how many other-user ratings `list_other_ratings` returns for
/// a single book. Practical usage stays well under this; the cap exists so
/// a heavily-rated book can't produce an unbounded REST response, mirroring
/// the cap on `bookmarks::LIST_BOOKMARKS_LIMIT`.
pub const LIST_OTHER_RATINGS_LIMIT: i64 = 1_000;

/// Failure space for the rating reads and writes.
#[derive(Debug, thiserror::Error)]
pub enum RatingError {
    #[error("book not found")]
    BookNotFound,
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl From<ReviewError> for RatingError {
    fn from(e: ReviewError) -> Self {
        match e {
            ReviewError::BookNotFound => Self::BookNotFound,
            ReviewError::Sqlx(inner) => Self::Sqlx(inner),
        }
    }
}

impl From<crate::books::BooksError> for RatingError {
    fn from(e: crate::books::BooksError) -> Self {
        ReviewError::from(e).into()
    }
}

/// Set the stars on the reader's review of a book and return the new
/// server-authoritative record. Resolves the request uuid to the **canonical**
/// `books.uuid` (keeping the `BookNotFound` guard — you cannot rate a book the
/// server has never indexed) and stores/keys on it.
pub async fn set_rating(
    pool: &SqlitePool,
    user_id: i64,
    update: &RatingUpdate,
) -> Result<RatingRecord, RatingError> {
    let patch = ReviewPatch {
        stars: Some(Some(update.stars)),
        ..Default::default()
    };
    let review = reviews::update_review(pool, user_id, &update.book_uuid, &patch).await?;
    // A patch that sets stars always leaves a review holding them.
    review
        .as_ref()
        .and_then(rating_record)
        .ok_or(RatingError::Sqlx(sqlx::Error::RowNotFound))
}

/// Fetch the current rating for `(user, book_uuid)`. Returns `Ok(None)` for an
/// unknown book uuid, an unreviewed book, or a review with no stars.
pub async fn get_rating(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<Option<RatingRecord>, RatingError> {
    let review = reviews::get_review(pool, user_id, book_uuid).await?;
    Ok(review.as_ref().and_then(rating_record))
}

/// List every other user's rating for a book, most recently rated first,
/// capped at [`LIST_OTHER_RATINGS_LIMIT`]. Reviews with no stars are skipped.
pub async fn list_other_ratings(
    pool: &SqlitePool,
    viewer_id: i64,
    book_uuid: &str,
) -> Result<Vec<AttributedRating>, RatingError> {
    let Some(canonical) = resolve_canonical_book_uuid(pool, book_uuid).await? else {
        return Ok(vec![]);
    };
    let rows = sqlx::query(
        "SELECT r.user_id, COALESCE(u.display_name, u.username) AS username,
                EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS has_avatar,
                r.half_stars, r.rated_at
           FROM reviews r
           JOIN users u ON u.id = r.user_id
          WHERE r.book_uuid = ? AND r.user_id != ? AND r.half_stars IS NOT NULL
          ORDER BY r.rated_at DESC, r.user_id DESC
          LIMIT ?",
    )
    .bind(canonical)
    .bind(viewer_id)
    .bind(LIST_OTHER_RATINGS_LIMIT)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(AttributedRating {
                user_id: row.try_get("user_id")?,
                username: row.try_get("username")?,
                has_avatar: row.try_get::<i64, _>("has_avatar")? != 0,
                stars: stars_from_half_stars(row.try_get("half_stars")?),
                updated_at: row.try_get("rated_at")?,
            })
        })
        .collect()
}

/// Clear the stars on the reader's review of a book (un-rate), keeping any
/// text and notes; a review with neither goes entirely. A no-op when there are
/// no stars — clearing an absent rating is not an error.
pub async fn delete_rating(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<(), RatingError> {
    let patch = ReviewPatch {
        stars: Some(None),
        ..Default::default()
    };
    match reviews::update_review(pool, user_id, book_uuid, &patch).await {
        Ok(_) | Err(ReviewError::BookNotFound) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// A review's stars as a rating, `rated_at` standing in for `updated_at`.
fn rating_record(review: &Review) -> Option<RatingRecord> {
    Some(RatingRecord {
        book_uuid: review.book_uuid.clone(),
        stars: review.stars?,
        updated_at: review.rated_at?,
    })
}

#[cfg(test)]
mod tests;
