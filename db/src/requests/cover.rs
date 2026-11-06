//! The cover a finished download brought, held as a candidate on its request until the
//! reader takes or keeps it. The import records the downloaded book's uuid before the
//! merge folds that book away; its cover file outlives the merge, so nothing is copied.
//! A cover is offered only while it has strictly more pixels than the one the book shows.

use std::io::Cursor;

use omnibus_shared::{CoverOffer, RequestState};
use sqlx::SqlitePool;

use crate::covers::{self, CoversError};

use super::store::{RequestError, RequestRow};

/// Offer the cover of `book_uuid`, the download as it was scanned in, on request `id`.
pub async fn record_candidate(
    pool: &SqlitePool,
    id: i64,
    book_uuid: &str,
) -> Result<(), RequestError> {
    sqlx::query("UPDATE book_requests SET cover_candidate = ? WHERE id = ?")
        .bind(book_uuid)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Clear request `id`'s candidate, but only while it is still `candidate`, so of two racing
/// settles one wins. [`RequestError::WrongState`] when it already was cleared.
pub async fn settle(pool: &SqlitePool, id: i64, candidate: &str) -> Result<(), RequestError> {
    let cleared = sqlx::query(
        "UPDATE book_requests SET cover_candidate = NULL WHERE id = ? AND cover_candidate = ?",
    )
    .bind(id)
    .bind(candidate)
    .execute(pool)
    .await?;
    if cleared.rows_affected() == 0 {
        return Err(RequestError::WrongState);
    }
    Ok(())
}

/// The candidate's cover as `(mime, bytes)`, or `None` when none is recorded or its file is gone.
pub async fn candidate_cover(row: &RequestRow) -> Option<(String, Vec<u8>)> {
    let uuid = row.cover_candidate.clone()?;
    match tokio::task::spawn_blocking(move || covers::find_cover_file(&uuid)).await {
        Ok(found) => found,
        Err(e) => {
            tracing::error!(error = %e, request = row.id, "reading a request's candidate cover");
            None
        }
    }
}

/// The candidate cover and the one the book shows (an uploaded cover first), when the request
/// is `ready` and the candidate has strictly more pixels.
pub async fn offer(
    pool: &SqlitePool,
    row: &RequestRow,
) -> Result<Option<CoverOffer>, RequestError> {
    if row.state != RequestState::Ready {
        return Ok(None);
    }
    let Some((_, candidate)) = candidate_cover(row).await else {
        return Ok(None);
    };
    let Some(book_id) = crate::resolve_book_id_by_uuid(pool, &row.book_uuid).await? else {
        return Ok(None);
    };
    let current = covers::get_cover(pool, book_id)
        .await
        .map_err(|CoversError::Db(e)| RequestError::Db(e))?;
    let Some((_, current)) = current else {
        return Ok(None);
    };
    let (Some((width, height)), Some((current_width, current_height))) =
        (dimensions(&candidate), dimensions(&current))
    else {
        return Ok(None);
    };
    let larger =
        u64::from(width) * u64::from(height) > u64::from(current_width) * u64::from(current_height);
    Ok(larger.then_some(CoverOffer {
        width,
        height,
        current_width,
        current_height,
    }))
}

/// An image's pixel size, read from its header alone; `None` when it is not an image.
fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

#[cfg(test)]
mod tests;
