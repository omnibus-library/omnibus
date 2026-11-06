//! The cover a finished download brought, held as a request-owned file until the reader takes
//! or keeps it. The import pulls the cover out of the placed download and keeps it under
//! `covers_dir()` as `request-<id>.<ext>`, so it never depends on what the scan or merge did
//! with the book's own cover; `book_requests.cover_candidate` names that file (its stem).
//! A cover is kept and offered only while it has strictly more pixels than the one the book shows.

use std::path::Path;

use omnibus_shared::{detect_image_format, CoverOffer, RequestState, MAX_IMAGE_BYTES};
use sqlx::SqlitePool;

use crate::covers::{self, CoversError};

use super::store::{RequestError, RequestRow};

/// What a reader is offered, with what taking it needs.
#[derive(Debug, PartialEq)]
pub struct Offer {
    pub sizes: CoverOffer,
    pub mime: String,
    pub bytes: Vec<u8>,
    /// The book the cover would replace the cover of.
    pub book_id: i64,
}

/// The stem of request `id`'s candidate file, which `cover_candidate` holds while it is on offer.
fn candidate_name(id: i64) -> String {
    format!("request-{id}")
}

/// An image fit to offer: within the size cap, a raster format, and with a readable size.
fn usable(bytes: &[u8]) -> Option<(String, (u32, u32))> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let mime = detect_image_format(bytes)?;
    let size = crate::metadata_lookup::cover::dimensions(bytes)?;
    Some((mime, size))
}

/// Whether a cover of `candidate` pixels has strictly more of them than one of `current`.
fn larger((width, height): (u32, u32), (current_width, current_height): (u32, u32)) -> bool {
    u64::from(width) * u64::from(height) > u64::from(current_width) * u64::from(current_height)
}

/// The cover the book `uuid` shows (an uploaded one first) with the book's id, or `None` when
/// it has no book or no cover.
async fn current_cover(
    pool: &SqlitePool,
    uuid: &str,
) -> Result<Option<(i64, Vec<u8>)>, RequestError> {
    let Some(book_id) = crate::resolve_book_id_by_uuid(pool, uuid).await? else {
        return Ok(None);
    };
    let cover = covers::get_cover(pool, book_id)
        .await
        .map_err(|CoversError::Db(e)| RequestError::Db(e))?;
    Ok(cover.map(|(_, bytes)| (book_id, bytes)))
}

/// Keep the cover of the EPUB at `epub` as request `id`'s candidate when it is a usable image
/// with more pixels than the cover book `book_uuid` shows now; otherwise record nothing.
pub async fn record_candidate(
    pool: &SqlitePool,
    id: i64,
    epub: &Path,
    book_uuid: &str,
) -> Result<(), RequestError> {
    let Some((_, current)) = current_cover(pool, book_uuid).await? else {
        return Ok(());
    };
    let epub = epub.to_path_buf();
    let name = candidate_name(id);
    let stem = name.clone();
    let kept = tokio::task::spawn_blocking(move || {
        let (_, bytes) = crate::ebook::extract_cover(&epub)?;
        let (mime, size) = usable(&bytes)?;
        let current = crate::metadata_lookup::cover::dimensions(&current)?;
        if !larger(size, current) {
            return None;
        }
        covers::delete_cover_files_for(std::slice::from_ref(&stem));
        covers::write_cover_file(&stem, &mime, &bytes).ok()
    })
    .await;
    match kept {
        Ok(Some(())) => reopen(pool, id, &name).await,
        Ok(None) => Ok(()),
        Err(e) => {
            tracing::error!(error = %e, request = id, "keeping a download's cover");
            Ok(())
        }
    }
}

/// Put `candidate` back on request `id`, as when taking it failed after it was settled.
pub async fn reopen(pool: &SqlitePool, id: i64, candidate: &str) -> Result<(), RequestError> {
    sqlx::query("UPDATE book_requests SET cover_candidate = ? WHERE id = ?")
        .bind(candidate)
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

/// Delete request `id`'s candidate file, once it is settled for good.
pub async fn discard(id: i64) {
    let name = candidate_name(id);
    let swept = tokio::task::spawn_blocking(move || {
        covers::delete_cover_files_for(std::slice::from_ref(&name));
    })
    .await;
    if let Err(e) = swept {
        tracing::error!(error = %e, request = id, "deleting a settled cover candidate");
    }
}

/// The candidate cover with what taking it needs, when the request is `ready` and it has
/// strictly more pixels than the cover the book shows (an uploaded one first).
pub async fn offer(pool: &SqlitePool, row: &RequestRow) -> Result<Option<Offer>, RequestError> {
    let Some(name) = row.cover_candidate.clone() else {
        return Ok(None);
    };
    if row.state != RequestState::Ready {
        return Ok(None);
    }
    let found = tokio::task::spawn_blocking(move || covers::find_cover_file(&name)).await;
    let found = found.unwrap_or_else(|e| {
        tracing::error!(error = %e, request = row.id, "reading a request's candidate cover");
        None
    });
    let Some((_, bytes)) = found else {
        return Ok(None);
    };
    let Some((mime, (width, height))) = usable(&bytes) else {
        return Ok(None);
    };
    let Some((book_id, current)) = current_cover(pool, &row.book_uuid).await? else {
        return Ok(None);
    };
    let Some((current_width, current_height)) = crate::metadata_lookup::cover::dimensions(&current)
    else {
        return Ok(None);
    };
    let sizes = CoverOffer {
        width,
        height,
        current_width,
        current_height,
    };
    Ok(
        larger((width, height), (current_width, current_height)).then_some(Offer {
            sizes,
            mime,
            bytes,
            book_id,
        }),
    )
}

#[cfg(test)]
mod tests;
