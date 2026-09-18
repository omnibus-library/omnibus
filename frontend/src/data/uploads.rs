//! "Add your own books" upload helpers. Like the author-photo upload, these
//! bypass the server-function transport (which can't carry binary payloads) and
//! post multipart bodies straight to the REST endpoints: `gloo-net` +
//! `FormData` on web, `reqwest::multipart` on mobile. The two-step shape —
//! `inspect_ebook` then `upload_ebook` — lets the UI review the whole record
//! before anything is created; the commit carries the file, the review diff,
//! and any staged cover in one request.

#[cfg(any(feature = "web", feature = "mobile"))]
use omnibus_shared::commit_fields;
use omnibus_shared::{
    AudiobookInspection, MetadataOverrides, UploadCommitResult, UploadInspection,
};

use super::DataError;
#[cfg(feature = "mobile")]
use super::{drain_error, http_client, note_status, with_bearer};

/// The cover a commit should give the new book.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum UploadCover {
    /// Whatever the indexer extracts from the file — no override written.
    #[default]
    Keep,
    /// An image the reader picked from disk during review.
    Bytes {
        filename: String,
        mime: String,
        bytes: Vec<u8>,
    },
    /// A provider's cover URL from the edition picker; the server fetches it.
    Url(String),
}

/// The user's confirmed metadata for the commit step. `title`/`author` are
/// required (they drive the on-disk folder); `series` fields are optional and
/// kept for an older server. `overrides` is the review form's diff against
/// the inspection — the server layers it over the four text fields and
/// prunes anything that restates the indexed value.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EbookUploadMeta {
    pub title: String,
    pub author: String,
    pub series: String,
    pub series_index: String,
    pub overrides: Option<MetadataOverrides>,
    pub cover: UploadCover,
}

/// The user's confirmed metadata for an audiobook commit — the same shape as
/// [`EbookUploadMeta`]. Audiobook containers rarely carry a series statement
/// of their own, so the review form is usually the only place it is supplied.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AudiobookUploadMeta {
    pub title: String,
    pub author: String,
    pub series: String,
    pub series_index: String,
    pub overrides: Option<MetadataOverrides>,
    pub cover: UploadCover,
}

/// Multipart content-type for an ebook upload, keyed off its extension. The
/// server re-derives the format from magic bytes, so this is advisory only.
#[cfg(any(feature = "web", feature = "mobile"))]
fn ebook_mime(filename: &str) -> &'static str {
    if filename.to_ascii_lowercase().ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/epub+zip"
    }
}

/// Multipart content-type for an audiobook part, keyed off its extension. The
/// server re-derives the format from magic bytes, so this is advisory only.
#[cfg(any(feature = "web", feature = "mobile"))]
fn audio_mime(filename: &str) -> &'static str {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".m4a") || lower.ends_with(".m4b") || lower.ends_with(".mp4") {
        "audio/mp4"
    } else {
        "application/octet-stream"
    }
}

/// The review diff as the JSON the commit carries, or `None` when there is
/// nothing to send — an empty diff is left off the wire entirely.
#[cfg(any(feature = "web", feature = "mobile"))]
fn overrides_json(overrides: &Option<MetadataOverrides>) -> Result<Option<String>, DataError> {
    match overrides {
        Some(ov) if *ov != MetadataOverrides::default() => serde_json::to_string(ov)
            .map(Some)
            .map_err(|e| DataError::Other(format!("encode overrides: {e}"))),
        _ => Ok(None),
    }
}

// Web (gloo-net + FormData).

/// Build a one-shot `Blob` from raw bytes with the given MIME type.
#[cfg(feature = "web")]
fn typed_blob(bytes: &[u8], mime: &str) -> Result<web_sys::Blob, DataError> {
    let u8 = js_sys::Uint8Array::from(bytes);
    let parts = js_sys::Array::new();
    parts.push(&u8);
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type(mime);
    web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts)
        .map_err(|e| DataError::Other(format!("Blob::new: {e:?}")))
}

/// Build a one-shot `Blob` from raw bytes, typed by the file's extension.
#[cfg(feature = "web")]
fn ebook_blob(bytes: &[u8], filename: &str) -> Result<web_sys::Blob, DataError> {
    typed_blob(bytes, ebook_mime(filename))
}

/// A URL the page can put in an `<img src>` for image bytes the reader just
/// picked, before they go anywhere: an object URL on web, an inline `data:`
/// URL on mobile. `None` where neither is available (SSR), which only means
/// the preview is skipped.
#[cfg(feature = "web")]
pub fn image_preview_url(bytes: &[u8], mime: &str) -> Option<String> {
    let blob = typed_blob(bytes, mime).ok()?;
    web_sys::Url::create_object_url_with_blob(&blob).ok()
}

/// Release a URL [`image_preview_url`] minted, once nothing shows it. Only
/// an object URL holds anything: a `data:` or provider URL passes through
/// untouched. Without this every pick pins its image bytes until the page
/// unloads.
#[cfg(feature = "web")]
pub fn revoke_preview_url(url: &str) {
    if url.starts_with("blob:") {
        let _ = web_sys::Url::revoke_object_url(url);
    }
}

/// Mobile and SSR previews hold nothing to release.
#[cfg(not(feature = "web"))]
pub fn revoke_preview_url(_url: &str) {}

/// Mobile: an inline `data:` URL — the WebView has no object-URL handle the
/// Rust side could mint.
#[cfg(all(feature = "mobile", not(feature = "web")))]
pub fn image_preview_url(bytes: &[u8], mime: &str) -> Option<String> {
    use base64::Engine as _;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// SSR: no preview.
#[cfg(not(any(feature = "web", feature = "mobile")))]
pub fn image_preview_url(_bytes: &[u8], _mime: &str) -> Option<String> {
    None
}

/// Append the review fields — the diff and the staged cover — to a commit
/// body. Shared by the ebook and audiobook commits.
#[cfg(feature = "web")]
fn append_review_fields(
    form: &web_sys::FormData,
    overrides: &Option<MetadataOverrides>,
    cover: &UploadCover,
) -> Result<(), DataError> {
    if let Some(json) = overrides_json(overrides)? {
        form.append_with_str(commit_fields::OVERRIDES, &json)
            .map_err(|e| DataError::Other(format!("FormData::append overrides: {e:?}")))?;
    }
    match cover {
        UploadCover::Keep => {}
        UploadCover::Bytes {
            filename,
            mime,
            bytes,
        } => {
            let blob = typed_blob(bytes, mime)?;
            form.append_with_blob_and_filename(commit_fields::COVER, &blob, filename)
                .map_err(|e| DataError::Other(format!("FormData::append cover: {e:?}")))?;
        }
        UploadCover::Url(url) => {
            form.append_with_str(commit_fields::COVER_URL, url)
                .map_err(|e| DataError::Other(format!("FormData::append cover_url: {e:?}")))?;
        }
    }
    Ok(())
}

/// Map a non-2xx web response to a `DataError`, surfacing 401 to the auth
/// state so the app can redirect to login. Consumes `res`.
#[cfg(feature = "web")]
async fn web_error(res: gloo_net::http::Response) -> DataError {
    if res.status() == 401 {
        super::web_auth_state::notify_unauthorized();
        return DataError::Unauthorized;
    }
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    DataError::Http { status, body }
}

/// Upload the file for server-side inspection ahead of the review step.
#[cfg(feature = "web")]
pub async fn inspect_ebook(
    _server_url: &str,
    filename: String,
    bytes: &[u8],
) -> Result<UploadInspection, DataError> {
    use gloo_net::http::Request;
    use wasm_bindgen::JsCast;

    let form =
        web_sys::FormData::new().map_err(|e| DataError::Other(format!("FormData::new: {e:?}")))?;
    let blob = ebook_blob(bytes, &filename)?;
    form.append_with_blob_and_filename("file", &blob, &filename)
        .map_err(|e| DataError::Other(format!("FormData::append: {e:?}")))?;

    let res = Request::post("/api/uploads/ebooks/inspect")
        .body(form.unchecked_into::<wasm_bindgen::JsValue>())
        .map_err(|e| DataError::Other(e.to_string()))?
        .send()
        .await
        .map_err(|e| DataError::Other(e.to_string()))?;
    if !res.ok() {
        return Err(web_error(res).await);
    }
    res.json::<UploadInspection>()
        .await
        .map_err(|e| DataError::Other(e.to_string()))
}

/// Commit a previously-inspected ebook to the library with the reviewed
/// metadata and any staged cover.
#[cfg(feature = "web")]
pub async fn upload_ebook(
    _server_url: &str,
    filename: String,
    bytes: Vec<u8>,
    meta: EbookUploadMeta,
) -> Result<UploadCommitResult, DataError> {
    use gloo_net::http::Request;
    use wasm_bindgen::JsCast;

    let form =
        web_sys::FormData::new().map_err(|e| DataError::Other(format!("FormData::new: {e:?}")))?;
    let append_str = |name: &str, value: &str| -> Result<(), DataError> {
        form.append_with_str(name, value)
            .map_err(|e| DataError::Other(format!("FormData::append {name}: {e:?}")))
    };
    append_str("title", &meta.title)?;
    append_str("author", &meta.author)?;
    if !meta.series.trim().is_empty() {
        append_str("series", &meta.series)?;
    }
    if !meta.series_index.trim().is_empty() {
        append_str("series_index", &meta.series_index)?;
    }
    append_review_fields(&form, &meta.overrides, &meta.cover)?;
    let blob = ebook_blob(&bytes, &filename)?;
    form.append_with_blob_and_filename("file", &blob, &filename)
        .map_err(|e| DataError::Other(format!("FormData::append: {e:?}")))?;

    let res = Request::post("/api/uploads/ebooks")
        .body(form.unchecked_into::<wasm_bindgen::JsValue>())
        .map_err(|e| DataError::Other(e.to_string()))?
        .send()
        .await
        .map_err(|e| DataError::Other(e.to_string()))?;
    if !res.ok() {
        return Err(web_error(res).await);
    }
    res.json::<UploadCommitResult>()
        .await
        .map_err(|e| DataError::Other(e.to_string()))
}

/// Append a text field only when the user actually filled it, so a blank
/// optional field never reaches the server as an empty override.
#[cfg(feature = "web")]
fn append_optional_str(form: &web_sys::FormData, name: &str, value: &str) -> Result<(), DataError> {
    if value.trim().is_empty() {
        return Ok(());
    }
    form.append_with_str(name, value)
        .map_err(|e| DataError::Other(format!("FormData::append {name}: {e:?}")))
}

/// Append one or more audiobook parts to a `FormData` under the `file` field,
/// each with a typed `Blob`.
#[cfg(feature = "web")]
fn append_audio_parts(
    form: &web_sys::FormData,
    files: &[(String, Vec<u8>)],
) -> Result<(), DataError> {
    for (name, bytes) in files {
        let blob = typed_blob(bytes, audio_mime(name))?;
        form.append_with_blob_and_filename("file", &blob, name)
            .map_err(|e| DataError::Other(format!("FormData::append: {e:?}")))?;
    }
    Ok(())
}

/// Upload the audiobook part(s) for server-side inspection ahead of the review
/// step. `files` is one `.m4a`/`.m4b` container or the ordered `.mp3` parts.
#[cfg(feature = "web")]
pub async fn inspect_audiobook(
    _server_url: &str,
    files: &[(String, Vec<u8>)],
) -> Result<AudiobookInspection, DataError> {
    use gloo_net::http::Request;
    use wasm_bindgen::JsCast;

    let form =
        web_sys::FormData::new().map_err(|e| DataError::Other(format!("FormData::new: {e:?}")))?;
    append_audio_parts(&form, files)?;

    let res = Request::post("/api/uploads/audiobooks/inspect")
        .body(form.unchecked_into::<wasm_bindgen::JsValue>())
        .map_err(|e| DataError::Other(e.to_string()))?
        .send()
        .await
        .map_err(|e| DataError::Other(e.to_string()))?;
    if !res.ok() {
        return Err(web_error(res).await);
    }
    res.json::<AudiobookInspection>()
        .await
        .map_err(|e| DataError::Other(e.to_string()))
}

/// Commit a previously-inspected audiobook to the library with the reviewed
/// metadata and any staged cover.
#[cfg(feature = "web")]
pub async fn upload_audiobook(
    _server_url: &str,
    files: Vec<(String, Vec<u8>)>,
    meta: AudiobookUploadMeta,
) -> Result<UploadCommitResult, DataError> {
    use gloo_net::http::Request;
    use wasm_bindgen::JsCast;

    let form =
        web_sys::FormData::new().map_err(|e| DataError::Other(format!("FormData::new: {e:?}")))?;
    form.append_with_str("title", &meta.title)
        .map_err(|e| DataError::Other(format!("FormData::append title: {e:?}")))?;
    form.append_with_str("author", &meta.author)
        .map_err(|e| DataError::Other(format!("FormData::append author: {e:?}")))?;
    append_optional_str(&form, "series", &meta.series)?;
    append_optional_str(&form, "series_index", &meta.series_index)?;
    append_review_fields(&form, &meta.overrides, &meta.cover)?;
    append_audio_parts(&form, &files)?;

    let res = Request::post("/api/uploads/audiobooks")
        .body(form.unchecked_into::<wasm_bindgen::JsValue>())
        .map_err(|e| DataError::Other(e.to_string()))?
        .send()
        .await
        .map_err(|e| DataError::Other(e.to_string()))?;
    if !res.ok() {
        return Err(web_error(res).await);
    }
    res.json::<UploadCommitResult>()
        .await
        .map_err(|e| DataError::Other(e.to_string()))
}

// Mobile (reqwest multipart).

/// Append the review fields to a mobile commit body — see the web
/// `append_review_fields`.
#[cfg(feature = "mobile")]
fn with_review_fields(
    mut form: reqwest::multipart::Form,
    overrides: &Option<MetadataOverrides>,
    cover: UploadCover,
) -> Result<reqwest::multipart::Form, DataError> {
    if let Some(json) = overrides_json(overrides)? {
        form = form.text(commit_fields::OVERRIDES, json);
    }
    match cover {
        UploadCover::Keep => {}
        UploadCover::Bytes {
            filename,
            mime,
            bytes,
        } => {
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(filename)
                .mime_str(&mime)?;
            form = form.part(commit_fields::COVER, part);
        }
        UploadCover::Url(url) => {
            form = form.text(commit_fields::COVER_URL, url);
        }
    }
    Ok(form)
}

/// Upload the file for server-side inspection ahead of the review step.
#[cfg(feature = "mobile")]
pub async fn inspect_ebook(
    server_url: &str,
    filename: String,
    bytes: &[u8],
) -> Result<UploadInspection, DataError> {
    crate::data::require_online()?;
    let endpoint = format!("{server_url}/api/uploads/ebooks/inspect");
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .mime_str(ebook_mime(&filename))?
        .file_name(filename);
    let form = reqwest::multipart::Form::new().part("file", part);
    let response = with_bearer(http_client().post(&endpoint))
        .multipart(form)
        .send()
        .await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<UploadInspection>().await?)
}

/// Commit a previously-inspected ebook to the library with the reviewed
/// metadata and any staged cover.
#[cfg(feature = "mobile")]
pub async fn upload_ebook(
    server_url: &str,
    filename: String,
    bytes: Vec<u8>,
    meta: EbookUploadMeta,
) -> Result<UploadCommitResult, DataError> {
    crate::data::require_online()?;
    let endpoint = format!("{server_url}/api/uploads/ebooks");
    let part = reqwest::multipart::Part::bytes(bytes)
        .mime_str(ebook_mime(&filename))?
        .file_name(filename);
    let mut form = reqwest::multipart::Form::new()
        .text("title", meta.title)
        .text("author", meta.author)
        .part("file", part);
    if !meta.series.trim().is_empty() {
        form = form.text("series", meta.series);
    }
    if !meta.series_index.trim().is_empty() {
        form = form.text("series_index", meta.series_index);
    }
    let form = with_review_fields(form, &meta.overrides, meta.cover)?;
    let response = with_bearer(http_client().post(&endpoint))
        .multipart(form)
        .send()
        .await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<UploadCommitResult>().await?)
}

/// Upload the audiobook part(s) for server-side inspection ahead of the review
/// step.
#[cfg(feature = "mobile")]
pub async fn inspect_audiobook(
    server_url: &str,
    files: &[(String, Vec<u8>)],
) -> Result<AudiobookInspection, DataError> {
    crate::data::require_online()?;
    let endpoint = format!("{server_url}/api/uploads/audiobooks/inspect");
    let mut form = reqwest::multipart::Form::new();
    for (name, bytes) in files {
        let part = reqwest::multipart::Part::bytes(bytes.clone())
            .file_name(name.clone())
            .mime_str(audio_mime(name))?;
        form = form.part("file", part);
    }
    let response = with_bearer(http_client().post(&endpoint))
        .multipart(form)
        .send()
        .await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<AudiobookInspection>().await?)
}

/// Commit a previously-inspected audiobook to the library with the reviewed
/// metadata and any staged cover.
#[cfg(feature = "mobile")]
pub async fn upload_audiobook(
    server_url: &str,
    files: Vec<(String, Vec<u8>)>,
    meta: AudiobookUploadMeta,
) -> Result<UploadCommitResult, DataError> {
    crate::data::require_online()?;
    let endpoint = format!("{server_url}/api/uploads/audiobooks");
    let mut form = reqwest::multipart::Form::new()
        .text("title", meta.title)
        .text("author", meta.author);
    if !meta.series.trim().is_empty() {
        form = form.text("series", meta.series);
    }
    if !meta.series_index.trim().is_empty() {
        form = form.text("series_index", meta.series_index);
    }
    form = with_review_fields(form, &meta.overrides, meta.cover)?;
    for (name, bytes) in files {
        let mime = audio_mime(&name);
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(name)
            .mime_str(mime)?;
        form = form.part("file", part);
    }
    let response = with_bearer(http_client().post(&endpoint))
        .multipart(form)
        .send()
        .await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<UploadCommitResult>().await?)
}

// Fallback stub (SSR / no platform feature).

/// Unavailable in this build — neither `web` nor `mobile` is enabled.
#[cfg(not(any(feature = "web", feature = "mobile")))]
pub async fn inspect_ebook(
    _server_url: &str,
    _filename: String,
    _bytes: &[u8],
) -> Result<UploadInspection, DataError> {
    Err(DataError::Other(
        "upload not available in this build".into(),
    ))
}

/// Unavailable in this build — neither `web` nor `mobile` is enabled.
#[cfg(not(any(feature = "web", feature = "mobile")))]
pub async fn upload_ebook(
    _server_url: &str,
    _filename: String,
    _bytes: Vec<u8>,
    _meta: EbookUploadMeta,
) -> Result<UploadCommitResult, DataError> {
    Err(DataError::Other(
        "upload not available in this build".into(),
    ))
}

/// Unavailable in this build — neither `web` nor `mobile` is enabled.
#[cfg(not(any(feature = "web", feature = "mobile")))]
pub async fn inspect_audiobook(
    _server_url: &str,
    _files: &[(String, Vec<u8>)],
) -> Result<AudiobookInspection, DataError> {
    Err(DataError::Other(
        "upload not available in this build".into(),
    ))
}

/// Unavailable in this build — neither `web` nor `mobile` is enabled.
#[cfg(not(any(feature = "web", feature = "mobile")))]
pub async fn upload_audiobook(
    _server_url: &str,
    _files: Vec<(String, Vec<u8>)>,
    _meta: AudiobookUploadMeta,
) -> Result<UploadCommitResult, DataError> {
    Err(DataError::Other(
        "upload not available in this build".into(),
    ))
}
