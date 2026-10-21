//! Per-reader book reviews: one row per `(reader, book)` holding optional half
//! stars, public Markdown text, private notes and a spoiler flag. Writes are
//! field-level patches, so a client changing the text can't clobber stars set
//! from another device; a review left with nothing in it is deleted. Notes
//! leave this module only inside the author's own [`Review`], and no timestamp
//! another reader sees moves when only the notes do. `rated_at` moves only when
//! the stars change, because it is the stats rating window key.
//!
//! Soft-references the durable `books.uuid` through the merged-uuid-aware
//! canonical resolver, like every per-reader table; `ratings` is the stars-only
//! view the older `/api/ratings` routes and the Kobo ingest still speak.

use std::collections::HashSet;

use omnibus_shared::{
    half_stars_from_stars, stars_from_half_stars, AttributedReview, BookReviews, Review,
    ReviewBucket, ReviewPatch, ReviewSummary, SUMMARY_MIN_RATINGS,
};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use crate::journals::markdown;
use crate::resolve_canonical_book_uuid;

#[cfg(test)]
mod tests;

/// Hard cap on how many other readers' reviews one book returns — a defensive
/// ceiling matching `LIST_JOURNAL_ENTRIES_LIMIT`.
pub const LIST_REVIEWS_LIMIT: i64 = 1_000;

/// Failure space for review reads and writes.
#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    #[error("book not found")]
    BookNotFound,
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl From<crate::books::BooksError> for ReviewError {
    fn from(e: crate::books::BooksError) -> Self {
        match e {
            crate::books::BooksError::Db(inner) => Self::Sqlx(inner),
            // `resolve_canonical_book_uuid` is the only `BooksError`-returning
            // call this module makes and it never reads overrides, so neither
            // remaining variant is reachable here (mirrors `journals`).
            crate::books::BooksError::OverridesJson(inner) => {
                Self::Sqlx(sqlx::Error::Decode(Box::new(inner)))
            }
            crate::books::BooksError::Other(msg) => Self::Sqlx(sqlx::Error::Decode(msg.into())),
        }
    }
}

/// The columns a patch writes — what a review *says*, without its timestamps.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Content {
    half_stars: Option<i64>,
    body_md: Option<String>,
    notes_md: Option<String>,
    spoiler: bool,
}

impl Content {
    fn apply(mut self, patch: &ReviewPatch) -> Self {
        if let Some(stars) = patch.stars {
            self.half_stars = stars.map(half_stars_from_stars);
        }
        if let Some(body) = &patch.body_md {
            self.body_md = non_blank(body.as_deref());
        }
        if let Some(notes) = &patch.notes_md {
            self.notes_md = non_blank(notes.as_deref());
        }
        if let Some(spoiler) = patch.spoiler {
            self.spoiler = spoiler;
        }
        self
    }

    fn is_empty(&self) -> bool {
        self.half_stars.is_none() && self.body_md.is_none() && self.notes_md.is_none()
    }

    /// Every journal-image name the text and notes embed.
    fn image_names(&self) -> HashSet<String> {
        [&self.body_md, &self.notes_md]
            .into_iter()
            .flatten()
            .flat_map(|md| crate::journal_images::referenced_image_names(md))
            .collect()
    }
}

/// Blank text clears the field rather than storing an empty review.
fn non_blank(text: Option<&str>) -> Option<String> {
    text.filter(|t| !t.trim().is_empty()).map(str::to_string)
}

/// The viewer's review, every other listed review and the summary for one book.
/// Errors with `BookNotFound` for a uuid the server has never indexed.
pub async fn get_book_reviews(
    pool: &SqlitePool,
    viewer_id: i64,
    book_uuid: &str,
) -> Result<BookReviews, ReviewError> {
    let canonical = resolve_canonical_book_uuid(pool, book_uuid)
        .await?
        .ok_or(ReviewError::BookNotFound)?;
    Ok(BookReviews {
        mine: load_own(pool, viewer_id, &canonical).await?,
        others: list_others(pool, viewer_id, &canonical).await?,
        summary: summarize(pool, &canonical).await?,
    })
}

/// The reader's own review of a book, notes included. `Ok(None)` for an
/// unknown book or one they haven't reviewed.
pub async fn get_review(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<Option<Review>, ReviewError> {
    let Some(canonical) = resolve_canonical_book_uuid(pool, book_uuid).await? else {
        return Ok(None);
    };
    load_own(pool, user_id, &canonical).await
}

/// Apply a field-level patch to the reader's review of a book, creating it on
/// first write, and return what is left — `None` when the patch emptied it,
/// which deletes the row. A patch that changes nothing writes nothing.
/// Callers validate the patch first.
pub async fn update_review(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
    patch: &ReviewPatch,
) -> Result<Option<Review>, ReviewError> {
    let canonical = resolve_canonical_book_uuid(pool, book_uuid)
        .await?
        .ok_or(ReviewError::BookNotFound)?;
    // BEGIN IMMEDIATE avoids a stale-snapshot 517 on concurrent writes (#1862).
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let old = load_content(&mut tx, user_id, &canonical).await?;
    let new = old.clone().unwrap_or_default().apply(patch);
    if old.as_ref() == Some(&new) || (old.is_none() && new.is_empty()) {
        tx.rollback().await?;
        return load_own(pool, user_id, &canonical).await;
    }
    if new.is_empty() {
        sqlx::query("DELETE FROM reviews WHERE user_id = ? AND book_uuid = ?")
            .bind(user_id)
            .bind(&canonical)
            .execute(&mut *tx)
            .await?;
    } else {
        upsert(&mut tx, user_id, &canonical, &new).await?;
    }
    tx.commit().await?;

    let dropped = old.map(|o| o.image_names()).unwrap_or_default();
    let kept = new.image_names();
    crate::journals::cleanup_orphaned_images(pool, &dropped - &kept).await;
    crate::stats::invalidate_user(user_id);
    load_own(pool, user_id, &canonical).await
}

/// Delete the reader's whole review of a book, notes included. A no-op when
/// there is none.
pub async fn delete_review(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<(), ReviewError> {
    let Some(canonical) = resolve_canonical_book_uuid(pool, book_uuid).await? else {
        return Ok(());
    };
    let deleted: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "DELETE FROM reviews WHERE user_id = ? AND book_uuid = ? RETURNING body_md, notes_md",
    )
    .bind(user_id)
    .bind(&canonical)
    .fetch_optional(pool)
    .await?;
    if let Some((body_md, notes_md)) = deleted {
        let content = Content {
            body_md,
            notes_md,
            ..Default::default()
        };
        crate::journals::cleanup_orphaned_images(pool, content.image_names()).await;
        crate::stats::invalidate_user(user_id);
    }
    Ok(())
}

/// Write `content` over the reader's row. Every timestamp others can see
/// follows only the public part — stars, text, spoiler flag — so an edit to
/// private notes can't be read off the review or the shared sort:
/// `created_at` restarts when text first arrives or a notes-only row gains
/// stars, `updated_at` holds through a notes-only edit, and `rated_at` holds
/// while the stars do. SQLite evaluates every `SET` expression against the
/// pre-update row, so each comparison sees the old values.
async fn upsert(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: i64,
    book_uuid: &str,
    content: &Content,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO reviews (user_id, book_uuid, half_stars, body_md, notes_md, spoiler, rated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                 CASE WHEN ?3 IS NULL THEN NULL ELSE strftime('%s','now') END)
         ON CONFLICT(user_id, book_uuid) DO UPDATE SET
             rated_at = CASE
                 WHEN excluded.half_stars IS NULL THEN NULL
                 WHEN excluded.half_stars IS reviews.half_stars THEN reviews.rated_at
                 ELSE strftime('%s','now')
             END,
             created_at = CASE
                 -- A text review dates and sorts from its text, never from an
                 -- older rating the text was added to.
                 WHEN reviews.body_md IS NULL AND excluded.body_md IS NOT NULL
                 THEN strftime('%s','now')
                 WHEN reviews.half_stars IS NULL AND reviews.body_md IS NULL
                  AND excluded.half_stars IS NOT NULL
                 THEN strftime('%s','now')
                 ELSE reviews.created_at
             END,
             updated_at = CASE
                 WHEN excluded.half_stars IS reviews.half_stars
                  AND excluded.body_md IS reviews.body_md
                  AND excluded.spoiler = reviews.spoiler
                 THEN reviews.updated_at
                 ELSE strftime('%s','now')
             END,
             half_stars = excluded.half_stars,
             body_md = excluded.body_md,
             notes_md = excluded.notes_md,
             spoiler = excluded.spoiler",
    )
    .bind(user_id)
    .bind(book_uuid)
    .bind(content.half_stars)
    .bind(&content.body_md)
    .bind(&content.notes_md)
    .bind(content.spoiler)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn load_content(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: i64,
    book_uuid: &str,
) -> Result<Option<Content>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT half_stars, body_md, notes_md, spoiler FROM reviews
          WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user_id)
    .bind(book_uuid)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|r| {
        Ok(Content {
            half_stars: r.try_get("half_stars")?,
            body_md: r.try_get("body_md")?,
            notes_md: r.try_get("notes_md")?,
            spoiler: r.try_get("spoiler")?,
        })
    })
    .transpose()
}

async fn load_own(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<Option<Review>, ReviewError> {
    let row = sqlx::query(
        "SELECT book_uuid, half_stars, body_md, notes_md, spoiler, rated_at, created_at, updated_at
           FROM reviews WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user_id)
    .bind(book_uuid)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let body_md: Option<String> = row.try_get("body_md")?;
    let notes_md: Option<String> = row.try_get("notes_md")?;
    Ok(Some(
        Review {
            book_uuid: row.try_get("book_uuid")?,
            stars: stars(&row)?,
            body_html: body_md.as_deref().map(markdown::render),
            body_md,
            notes_html: notes_md.as_deref().map(markdown::render),
            notes_md,
            spoiler: row.try_get("spoiler")?,
            rated_at: row.try_get("rated_at")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            rated_at_iso: None,
            created_at_iso: None,
            updated_at_iso: None,
        }
        .with_iso(),
    ))
}

/// Every other reader's review with stars or text, never their notes: text
/// first by when it was written, then bare ratings by when they were given.
async fn list_others(
    pool: &SqlitePool,
    viewer_id: i64,
    book_uuid: &str,
) -> Result<Vec<AttributedReview>, ReviewError> {
    let rows = sqlx::query(
        "SELECT r.user_id, COALESCE(u.display_name, u.username) AS username,
                EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS has_avatar,
                r.half_stars, r.body_md, r.spoiler, r.rated_at, r.created_at, r.updated_at
           FROM reviews r
           JOIN users u ON u.id = r.user_id
          WHERE r.book_uuid = ? AND r.user_id != ?
            AND (r.half_stars IS NOT NULL OR r.body_md IS NOT NULL)
          ORDER BY r.body_md IS NULL,
                   CASE WHEN r.body_md IS NULL THEN r.rated_at ELSE r.created_at END DESC,
                   r.user_id DESC
          LIMIT ?",
    )
    .bind(book_uuid)
    .bind(viewer_id)
    .bind(LIST_REVIEWS_LIMIT)
    .fetch_all(pool)
    .await?;
    rows.iter().map(row_to_attributed).collect()
}

fn row_to_attributed(row: &SqliteRow) -> Result<AttributedReview, ReviewError> {
    let body_md: Option<String> = row.try_get("body_md")?;
    Ok(AttributedReview {
        user_id: row.try_get("user_id")?,
        username: row.try_get("username")?,
        has_avatar: row.try_get::<i64, _>("has_avatar")? != 0,
        stars: stars(row)?,
        body_html: body_md.as_deref().map(markdown::render),
        body_md,
        spoiler: row.try_get("spoiler")?,
        rated_at: row.try_get("rated_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        rated_at_iso: None,
        created_at_iso: None,
        updated_at_iso: None,
    }
    .with_iso())
}

/// Every reader's stars on the book, the viewer's included, or `None` below
/// [`SUMMARY_MIN_RATINGS`] — where an "average" is just one person's rating.
async fn summarize(
    pool: &SqlitePool,
    book_uuid: &str,
) -> Result<Option<ReviewSummary>, ReviewError> {
    let counts: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT half_stars, COUNT(*) FROM reviews
          WHERE book_uuid = ? AND half_stars IS NOT NULL
          GROUP BY half_stars",
    )
    .bind(book_uuid)
    .fetch_all(pool)
    .await?;
    let ratings: i64 = counts.iter().map(|(_, n)| n).sum();
    if ratings < SUMMARY_MIN_RATINGS {
        return Ok(None);
    }
    let half_star_total: i64 = counts.iter().map(|(h, n)| h * n).sum();
    let buckets = (1..=10)
        .map(|half_stars| ReviewBucket {
            half_stars,
            readers: counts
                .iter()
                .find(|(h, _)| *h == half_stars)
                .map_or(0, |(_, n)| *n),
        })
        .collect();
    // Both counts are tiny next to f64's exact-integer range.
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
    let average_stars = (half_star_total as f64 / ratings as f64 / 2.0) as f32;
    Ok(Some(ReviewSummary {
        average_stars,
        ratings,
        buckets,
    }))
}

fn stars(row: &SqliteRow) -> Result<Option<f32>, sqlx::Error> {
    Ok(row
        .try_get::<Option<i64>, _>("half_stars")?
        .map(stars_from_half_stars))
}
