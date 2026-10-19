//! `/api/ebooks/{uuid}/images*` handlers: the listing of an EPUB's images, one
//! image's original bytes, and the signed link that fetches those bytes without
//! a session. The listing and `/images/file` are [`MediaAuthUser`]-gated (`?token=`
//! for clients that cannot set headers); `/images/signed` takes no session and is
//! authenticated by its signature alone. A book without an EPUB answers 422,
//! distinct from the 404 for an unknown uuid.
//!
//! A link is an HMAC over (uuid, href, expiry) under the server's secret: it opens
//! that one image until it expires and nothing else, so a leaked URL is not a session.

use std::path::PathBuf;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{digest::InvalidLength, Hmac, Mac};
use omnibus_db::{
    self as db,
    ebook::images::{list_images, read_image},
};
use omnibus_shared::{BookImageLink, BookImageList, ImageHrefQuery, SignedImageQuery};
use sha2::Sha256;

use crate::auth::{AuthUser, MediaAuthUser};
use crate::backend::conditional::{self, MEDIA_CACHE_CONTROL, MEDIA_VARY};
use crate::backend::{content_disposition_attachment, deny_without_download, internal, AppState};

/// How long a minted image link opens its one image.
pub(crate) const IMAGE_LINK_TTL_SECS: i64 = 15 * 60;

/// Domain tag so a MAC minted here can never be replayed as one for another purpose.
const IMAGE_LINK_DOMAIN: &[u8] = b"omnibus-image-link";

type HmacSha256 = Hmac<Sha256>;

fn now_secs() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

/// HMAC-SHA256 over the domain tag and each field length-prefixed, so no two
/// distinct `(uuid, href, expires)` triples encode alike.
fn image_link_mac(
    key: &[u8],
    uuid: &str,
    href: &str,
    expires: i64,
) -> Result<HmacSha256, InvalidLength> {
    let mut mac = HmacSha256::new_from_slice(key)?;
    mac.update(IMAGE_LINK_DOMAIN);
    for field in [uuid, href] {
        mac.update(&(field.len() as u64).to_be_bytes());
        mac.update(field.as_bytes());
    }
    mac.update(&expires.to_be_bytes());
    Ok(mac)
}

/// The base64url signature binding `(uuid, href, expires)` under `key`.
pub(crate) fn sign_image_link(
    key: &[u8],
    uuid: &str,
    href: &str,
    expires: i64,
) -> Result<String, InvalidLength> {
    let tag = image_link_mac(key, uuid, href, expires)?
        .finalize()
        .into_bytes();
    Ok(URL_SAFE_NO_PAD.encode(tag))
}

/// Whether `sig` is [`sign_image_link`]'s output for exactly this triple, compared
/// in constant time.
pub(crate) fn verify_image_link(
    key: &[u8],
    uuid: &str,
    href: &str,
    expires: i64,
    sig: &str,
) -> bool {
    let Ok(tag) = URL_SAFE_NO_PAD.decode(sig) else {
        return false;
    };
    image_link_mac(key, uuid, href, expires).is_ok_and(|mac| mac.verify_slice(&tag).is_ok())
}

/// Get a signed link to an image
///
/// A path that fetches one image's original file without a session for 15 minutes, for
/// handing to something that can't send your token. It opens that one image and nothing
/// else. `href` isn't checked against the book's images until the link is used. Needs the
/// download permission.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/images/link",
    tag = "Library",
    params(("uuid" = String, Path, description = "The book's uuid."), ImageHrefQuery),
    responses(
        (status = 200, description = "The link.", body = BookImageLink),
        (status = 403, description = "Your account lacks the download permission."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(crate) async fn get_ebook_image_link(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(q): Query<ImageHrefQuery>,
) -> Response {
    // A GET because it writes nothing: the link is a stateless MAC, and the fetch
    // validates `href` when the link is used.
    if let Some(denied) = deny_without_download(&user) {
        return denied;
    }
    match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(_)) => {}
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    }
    let key = match db::auth::load_or_create_session_key(&state.pool).await {
        Ok(key) => key,
        Err(e) => return internal("load_or_create_session_key", e),
    };
    let expires_at = now_secs() + IMAGE_LINK_TTL_SECS;
    let sig = match sign_image_link(&key, &uuid, &q.href, expires_at) {
        Ok(sig) => sig,
        Err(e) => return internal("sign_image_link", e),
    };
    let path = format!(
        "/api/ebooks/{uuid}/images/signed?href={}&expires={expires_at}&sig={sig}",
        urlencoding::encode(&q.href)
    );
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(BookImageLink { path, expires_at }),
    )
        .into_response()
}

const NOT_AN_IMAGE: &str = "href is not an image in this book's EPUB manifest";

/// List a book's images
///
/// Every image in the book's EPUB, such as maps and illustrations, with the spine documents
/// that show each one.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/images",
    tag = "Library",
    security(("bearer" = []), ("session_cookie" = []), ("media_token" = [])),
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The images.", body = BookImageList),
        (status = 404, description = "No book has that uuid."),
        (status = 422, description = "The book has no EPUB."),
    ),
)]
pub(crate) async fn get_ebook_images(
    _user: MediaAuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    let path = match epub_path(&state, &uuid).await {
        Ok(path) => path,
        Err(rejection) => return rejection,
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

/// The book's EPUB path, or the rejection: 404 unknown uuid, 422 no EPUB, 500 lookup failure.
async fn epub_path(state: &AppState, uuid: &str) -> Result<PathBuf, Response> {
    let id = match db::resolve_book_id_by_uuid(&state.pool, uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return Err(StatusCode::NOT_FOUND.into_response()),
        Err(e) => return Err(internal("resolve_book_id_by_uuid", e)),
    };
    match db::book_file_path(&state.pool, id, "EPUB").await {
        Ok(Some(path)) => Ok(path),
        Ok(None) => {
            Err((StatusCode::UNPROCESSABLE_ENTITY, "book has no EPUB file").into_response())
        }
        Err(e) => Err(internal("book_file_path", e)),
    }
}

/// Download one of a book's images
///
/// The image's original file from the book's EPUB, as an attachment. `href` is the image's
/// path from `GET /api/ebooks/{uuid}/images`. Needs the download permission.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/images/file",
    tag = "Library",
    params(("uuid" = String, Path, description = "The book's uuid."), ImageHrefQuery),
    responses(
        (status = 200, description = "The image.", body = [u8], content_type = "image/*",
            headers(("Content-Disposition" = String, description = "`attachment`, with the image's file name."))),
        (status = 304, description = "The image is unchanged since the `ETag` sent in `If-None-Match`, or the date in `If-Modified-Since`."),
        (status = 400, description = "`href` isn't an image in the book's EPUB."),
        (status = 403, description = "Your account lacks the download permission."),
        (status = 404, description = "No book has that uuid."),
        (status = 412, description = "`If-Match` or `If-Unmodified-Since` doesn't match the image."),
        (status = 422, description = "The book has no EPUB."),
    ),
)]
pub(crate) async fn get_ebook_image_file(
    user: MediaAuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(q): Query<ImageHrefQuery>,
    headers: HeaderMap,
) -> Response {
    if let Some(denied) = deny_without_download(&user.0) {
        return denied;
    }
    // Every 200 is an `attachment`: an `image/svg+xml` body opened top-level would run
    // inline script under the app's CSP.
    serve_image(&state, &uuid, &q.href, &headers).await
}

/// Open an image through a signed link
///
/// The image a link from `GET /api/ebooks/{uuid}/images/link` points at, as an attachment.
/// The link's signature is its only credential: no session is needed or read. Use the
/// link's path as it is.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/images/signed",
    tag = "Library",
    security(()),
    params(("uuid" = String, Path, description = "The book's uuid."), SignedImageQuery),
    responses(
        (status = 200, description = "The image.", body = [u8], content_type = "image/*",
            headers(("Content-Disposition" = String, description = "`attachment`, with the image's file name."))),
        (status = 304, description = "The image is unchanged since the `ETag` sent in `If-None-Match`, or the date in `If-Modified-Since`."),
        (status = 400, description = "`href` isn't an image in the book's EPUB."),
        (status = 401, description = "The link has expired, or its signature doesn't match."),
        (status = 404, description = "No book has that uuid."),
        (status = 412, description = "`If-Match` or `If-Unmodified-Since` doesn't match the image."),
        (status = 422, description = "The book has no EPUB."),
    ),
)]
pub(crate) async fn get_ebook_signed_image(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(q): Query<SignedImageQuery>,
    headers: HeaderMap,
) -> Response {
    // The download permission was enforced when the link was minted. `expires` and
    // `sig` are text so a malformed or missing value is a 401, not a 400.
    if let Some(rejected) = reject_bad_link(&state, &uuid, &q).await {
        return rejected;
    }
    serve_image(&state, &uuid, &q.href, &headers).await
}

/// `Some(401)` unless `q` carries a live signature over this (uuid, href);
/// `Some(500)` when the key cannot be read.
async fn reject_bad_link(state: &AppState, uuid: &str, q: &SignedImageQuery) -> Option<Response> {
    let rejected = || (StatusCode::UNAUTHORIZED, "invalid or expired link").into_response();
    let Some(sig) = q.sig.as_deref() else {
        return Some(rejected());
    };
    let Some(expires) = q.expires.as_deref().and_then(|e| e.parse::<i64>().ok()) else {
        return Some(rejected());
    };
    if expires < now_secs() {
        return Some(rejected());
    }
    // No key yet means no link was ever minted; reading must not create one for an anonymous caller.
    let key = match db::auth::get_session_key(&state.pool).await {
        Ok(Some(key)) => key,
        Ok(None) => return Some(rejected()),
        Err(e) => return Some(internal("get_session_key", e)),
    };
    (!verify_image_link(&key, uuid, &q.href, expires, sig)).then(rejected)
}

/// 404 unknown uuid, 422 no EPUB, 400 `href` not a manifest image, then every
/// precondition settled by [`conditional::evaluate`]. One open handle gives both
/// the validator and the bytes (rule 09a).
async fn serve_image(state: &AppState, uuid: &str, href: &str, headers: &HeaderMap) -> Response {
    let path = match epub_path(state, uuid).await {
        Ok(path) => path,
        Err(rejection) => return rejection,
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
    let last_modified = open.validator.last_modified;
    let file = open.into_std().await;
    let wanted = href.to_string();
    let read = tokio::task::spawn_blocking(move || read_image(file, &wanted)).await;
    let (media_type, bytes) = match read {
        Ok(Ok(Some(image))) => image,
        Ok(Ok(None)) => return (StatusCode::BAD_REQUEST, NOT_AN_IMAGE).into_response(),
        // Debug-quoted so a newline in a manifest href cannot forge a log line.
        Ok(Err(e)) => return internal("read_image", format!("{:?}", e.to_string())),
        Err(e) => return internal("read_image", e),
    };
    let validator = conditional::Validator {
        etag,
        last_modified,
    };
    match conditional::evaluate(headers, &validator, bytes.len() as u64) {
        conditional::Precondition::NotModified(etag) => {
            return conditional::not_modified(&etag, MEDIA_CACHE_CONTROL, MEDIA_VARY)
        }
        conditional::Precondition::Failed => {
            return StatusCode::PRECONDITION_FAILED.into_response()
        }
        // The route sends no `Accept-Ranges`, so serving the full body for a `Range` is allowed.
        conditional::Precondition::Proceed { .. } => {}
    }
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
            (header::ETAG, validator.etag.as_str()),
            (header::VARY, MEDIA_VARY),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests;
