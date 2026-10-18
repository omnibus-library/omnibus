//! `/api/ebooks/{uuid}/images*` handlers: the listing of an EPUB's images.
//! [`MediaAuthUser`]-gated, so a client that cannot set headers may carry the
//! session as `?token=`. A book without an EPUB answers 422, distinct from the
//! 404 for an unknown uuid, so a caller can tell "no such book" from "no images
//! to list in this format".

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    ebook::images::{list_images, read_image},
};
use omnibus_shared::BookImageList;
use serde::Deserialize;

use crate::auth::MediaAuthUser;
use crate::backend::conditional::{self, MEDIA_CACHE_CONTROL, MEDIA_VARY};
use crate::backend::{content_disposition_attachment, deny_without_download, internal, AppState};

const NOT_AN_IMAGE: &str = "href is not an image in this book's EPUB manifest";

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

/// Query params for `GET /api/ebooks/{uuid}/images/file`.
#[derive(Deserialize)]
pub(crate) struct ImageFileQuery {
    href: String,
}

/// One image's original bytes, by the archive path `list_book_images` reports.
/// Download-shaped: every 200 is an `attachment`, because an `image/svg+xml` body
/// opened top-level would run inline script under the app's CSP, and the
/// download permission gates it like any other file handed out to keep.
pub(crate) async fn get_ebook_image_file(
    user: MediaAuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(q): Query<ImageFileQuery>,
    headers: HeaderMap,
) -> Response {
    if let Some(denied) = deny_without_download(&user.0) {
        return denied;
    }
    serve_image(&state, &uuid, &q.href, &headers).await
}

/// 404 unknown uuid, 422 no EPUB, 400 `href` not a manifest image. One open
/// handle gives both the validator and the bytes (rule 09a); a matching
/// `If-None-Match` answers 304 before the EPUB is parsed, since it proves this
/// exact (file, href) was served before.
async fn serve_image(state: &AppState, uuid: &str, href: &str, headers: &HeaderMap) -> Response {
    let id = match db::resolve_book_id_by_uuid(&state.pool, uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    let path = match db::book_file_path(&state.pool, id, "EPUB").await {
        Ok(Some(p)) => p,
        Ok(None) => return no_epub(),
        Err(e) => return internal("book_file_path", e),
    };
    let open = match conditional::open(&path).await {
        Ok(o) => o,
        Err(e) => return internal("open epub for image validator", e),
    };
    let etag = format!(
        "\"{}-i{}\"",
        open.validator.etag.trim_matches('"'),
        conditional::content_etag(href.as_bytes()).trim_matches('"')
    );
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| conditional::if_none_match_hits(v, &etag))
    {
        return conditional::not_modified(&etag, MEDIA_CACHE_CONTROL, MEDIA_VARY);
    }

    let file = open.into_std().await;
    let wanted = href.to_string();
    let read = tokio::task::spawn_blocking(move || read_image(file, &wanted)).await;
    let (media_type, bytes) = match read {
        Ok(Ok(Some(image))) => image,
        Ok(Ok(None)) => return (StatusCode::BAD_REQUEST, NOT_AN_IMAGE).into_response(),
        Ok(Err(e)) => return internal("read_image", e),
        Err(e) => return internal("read_image", e),
    };
    // The manifest's media type is untrusted text; one that is not a legal header
    // value must not reach the response.
    let content_type = if HeaderValue::from_str(&media_type).is_ok() {
        media_type.as_str()
    } else {
        "application/octet-stream"
    };
    let disposition = content_disposition_attachment(href.rsplit('/').next().unwrap_or(href));
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_DISPOSITION, disposition.as_str()),
            (header::CACHE_CONTROL, MEDIA_CACHE_CONTROL),
            (header::ETAG, etag.as_str()),
            (header::VARY, MEDIA_VARY),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}
