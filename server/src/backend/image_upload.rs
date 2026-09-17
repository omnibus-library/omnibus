//! Shared multipart image-upload validation: content-type check, SVG
//! rejection, size cap, and magic-byte sniff. Used by the cover-upload
//! (`overrides::post_ebook_cover`), author-photo-upload
//! (`author_photos::put_author_photo`) and book-upload commit
//! (`uploads`, for a cover staged during review) handlers so the pipelines
//! can't drift out of sync.

use axum::body::Bytes;
use axum::extract::multipart::Field;
use axum::response::{IntoResponse, Response};
use omnibus_shared::detect_image_format;

use super::internal;

/// Largest image any of the three pipelines accepts.
pub(super) const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

/// Why an image field was refused. Typed so a handler with its own error
/// enum (the upload commit) can carry it, while the two cover/photo
/// handlers turn it straight into a response with [`Self::into_response`].
#[derive(Debug)]
pub(super) enum ImageFieldError {
    /// Content-type isn't `image/*` → 400.
    NotImage,
    /// SVG carries executable content and can XSS when opened directly → 400.
    Svg,
    /// Over [`MAX_IMAGE_BYTES`] → 400.
    TooLarge,
    /// Bytes carry no recognisable image header → 415.
    Undetectable,
    /// The multipart body could not be read → 500.
    Read(String),
}

impl ImageFieldError {
    /// The response the cover and photo handlers return, worded around the
    /// field the client sent (`cover`, `photo`).
    pub(super) fn into_response(self, field_name: &str) -> Response {
        use axum::http::StatusCode;
        match self {
            ImageFieldError::NotImage => (
                StatusCode::BAD_REQUEST,
                format!("{field_name} must be an image"),
            )
                .into_response(),
            ImageFieldError::Svg => (
                StatusCode::BAD_REQUEST,
                format!("SVG {field_name}s are not accepted"),
            )
                .into_response(),
            ImageFieldError::TooLarge => (
                StatusCode::BAD_REQUEST,
                format!("{field_name} must be under 10 MB"),
            )
                .into_response(),
            ImageFieldError::Undetectable => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Could not detect image format",
            )
                .into_response(),
            ImageFieldError::Read(detail) => internal("read image field", detail),
        }
    }

    /// The message a typed caller shows, without the status.
    pub(super) fn message(&self, field_name: &str) -> String {
        match self {
            ImageFieldError::NotImage => format!("{field_name} must be an image"),
            ImageFieldError::Svg => format!("SVG {field_name}s are not accepted"),
            ImageFieldError::TooLarge => format!("{field_name} must be under 10 MB"),
            ImageFieldError::Undetectable => "Could not detect image format".to_string(),
            ImageFieldError::Read(detail) => detail.clone(),
        }
    }
}

/// Read one already-selected multipart field as an image: content-type
/// check, SVG rejection, size cap, magic-byte sniff. Returns the *detected*
/// MIME + bytes, never the client's header — the stored extension has to
/// match the actual content.
pub(super) async fn read_image_field(field: Field<'_>) -> Result<(String, Bytes), ImageFieldError> {
    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    if !content_type.starts_with("image/") {
        return Err(ImageFieldError::NotImage);
    }
    if content_type.contains("svg") {
        return Err(ImageFieldError::Svg);
    }
    let bytes = field
        .bytes()
        .await
        .map_err(|e| ImageFieldError::Read(e.to_string()))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ImageFieldError::TooLarge);
    }
    // A `None` here means the bytes carry no recognisable image header, so
    // surface a 415 rather than `.unwrap()`-panicking the task (#210).
    match detect_image_format(&bytes) {
        Some(mime) => Ok((mime, bytes)),
        None => Err(ImageFieldError::Undetectable),
    }
}

/// Reads the `field_name` field out of `multipart`, validating it with
/// [`read_image_field`]. Returns the detected MIME + bytes on success, or the
/// exact error `Response` the caller should return on failure.
pub(super) async fn extract_validated_image(
    multipart: &mut axum::extract::Multipart,
    field_name: &str,
) -> Result<(String, Bytes), Response> {
    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let name = field.name().unwrap_or("").to_string();
                if name != field_name {
                    continue;
                }
                return read_image_field(field)
                    .await
                    .map_err(|e| e.into_response(field_name));
            }
            Ok(None) => {
                return Err((
                    axum::http::StatusCode::BAD_REQUEST,
                    format!("missing '{field_name}' field in multipart body"),
                )
                    .into_response())
            }
            Err(e) => return Err(internal("parse multipart", e)),
        }
    }
}

#[cfg(test)]
mod tests;
