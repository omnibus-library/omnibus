//! `/api/ebooks/{uuid}/images*` handlers: the listing of an EPUB's images.
//! [`MediaAuthUser`]-gated, so a client that cannot set headers may carry the
//! session as `?token=`. A book without an EPUB answers 422, distinct from the
//! 404 for an unknown uuid, so a caller can tell "no such book" from "no images
//! to list in this format".

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, ebook::images::list_images};
use omnibus_shared::BookImageList;

use crate::auth::MediaAuthUser;
use crate::backend::{internal, AppState};

/// Every manifest image of the book's EPUB with the spine documents that show it.
pub(crate) async fn get_ebook_images(
    _user: MediaAuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    let path = match db::book_file_path(&state.pool, id, "EPUB").await {
        Ok(Some(p)) => p,
        Ok(None) => return no_epub(),
        Err(e) => return internal("book_file_path", e),
    };
    let listed = tokio::task::spawn_blocking(move || list_images(&path)).await;
    let images = match listed {
        Ok(Ok(images)) => images,
        Ok(Err(e)) => return internal("list_images", e),
        Err(e) => return internal("list_images", e),
    };
    Json(BookImageList {
        book_uuid: uuid,
        images,
    })
    .into_response()
}

fn no_epub() -> Response {
    (StatusCode::UNPROCESSABLE_ENTITY, "book has no EPUB file").into_response()
}
