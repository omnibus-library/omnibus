//! `GET /koreader/v1/library` (the books on the reader's synced shelves) and
//! `GET /koreader/v1/books/{uuid}/file` (one book's bytes), the two reads a
//! plugin sync makes.

use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, kobo::KoboBookRow};
use serde::Serialize;

use super::extractor::KoreaderDevice;
use crate::backend::ebooks::{device_file, rewritten_or_source, DeviceFile, EPUB_MIME};
use crate::backend::kobo::reject_oversized_uuid;
use crate::backend::{deny_unless_can_download, serve_download, AppState};
use crate::http_errors::internal;

#[derive(Serialize)]
struct Library {
    books: Vec<LibraryBook>,
}

/// One book the plugin should hold. `download_url` is host-relative so the plugin
/// joins it to the server it was configured with and never sends its token elsewhere.
#[derive(Serialize)]
struct LibraryBook {
    uuid: String,
    title: String,
    authors: Vec<String>,
    format: String,
    size: i64,
    last_modified: i64,
    download_url: String,
}

impl From<KoboBookRow> for LibraryBook {
    fn from(book: KoboBookRow) -> Self {
        Self {
            download_url: format!("/koreader/v1/books/{}/file", book.uuid),
            format: book.file_format().to_lowercase(),
            uuid: book.uuid,
            title: book.title,
            authors: book.authors,
            size: book.download_size_bytes,
            last_modified: book.last_modified_epoch,
        }
    }
}

/// The books on the owner's `sync_to_kobo` shelves: the same set a Kobo syncs.
pub async fn library(device: KoreaderDevice, State(state): State<AppState>) -> Response {
    match db::kobo::sync_books(state.pool(), device.user_id).await {
        Ok(rows) => Json(Library {
            books: rows.into_iter().map(LibraryBook::from).collect(),
        })
        .into_response(),
        Err(e) => internal("koreader sync_books", e),
    }
}

/// One book as plain EPUB (override-baked), else its CBZ or PDF, through the shared
/// validated-bytes path. Needs the owner's download permission, like OPDS.
pub async fn file(
    device: KoreaderDevice,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    req: Request,
) -> Response {
    match db::auth::get_user_by_id(state.pool(), device.user_id).await {
        Ok(Some(user)) => {
            if let Some(denied) = deny_unless_can_download(user.can_download) {
                return denied;
            }
        }
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(e) => return internal("koreader get_user_by_id", e),
    }
    if let Some(rejected) = reject_oversized_uuid(&uuid) {
        return rejected;
    }
    let id = match db::resolve_book_id_by_uuid(state.pool(), &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("koreader resolve_book_id_by_uuid", e),
    };
    let (path, mime) = match device_file(&state, id).await {
        Ok(Some(DeviceFile::Epub(source))) => {
            (rewritten_or_source(&state, id, source).await, EPUB_MIME)
        }
        Ok(Some(DeviceFile::Other(path, mime))) => (path, mime),
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("koreader device_file", e),
    };
    serve_download(req, &path, mime).await
}
