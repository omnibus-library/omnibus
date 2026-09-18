//! "Add your own books" upload handlers (web-facing REST). Two-step ingest
//! shared by ebooks and audiobooks: `inspect` parses the upload into what
//! the review form edits without creating anything; commit files the bytes
//! into the canonical library folder, reindexes so the indexer owns the
//! insert, then layers the edits and any staged cover on (`review`).

use std::path::{Path, PathBuf};

use axum::{
    extract::{multipart::Field, Multipart, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db, library_layout,
    worker::{Task, TaskOutcome},
};
use omnibus_shared::{
    detect_ebook_format, Contributor, UploadCommitResult, UploadInspection, EBOOK_MAGIC_LEN,
};
use tokio::io::AsyncWriteExt as _;

use self::review::{CommitExtras, LegacyFields};
use super::AppState;
use crate::auth::AuthUser;

/// Default upload size cap (1 GiB) when `OMNIBUS_MAX_UPLOAD_BYTES` is unset or
/// unparseable. Generous so it survives the future large-audiobook case.
pub const DEFAULT_MAX_UPLOAD_BYTES: usize = 1024 * 1024 * 1024;

/// Per-field byte cap for the commit multipart's text fields
/// (title/author/series/series_index), enforced incrementally while
/// streaming so an oversized field is rejected before it's fully buffered.
/// Generous headroom over `MetadataOverrides`' char caps (500 for title, 250
/// for the rest) while still bounding memory ahead of that later validation.
const MAX_TEXT_FIELD_BYTES: usize = 8 * 1024;

/// Resolve the configured upload size cap from `OMNIBUS_MAX_UPLOAD_BYTES`,
/// falling back to [`DEFAULT_MAX_UPLOAD_BYTES`]. Read at router-build time for
/// the body limit and again per-request as a defense-in-depth backstop.
pub fn max_upload_bytes() -> usize {
    std::env::var("OMNIBUS_MAX_UPLOAD_BYTES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_UPLOAD_BYTES)
}

/// Predictable upload failures. Mapped to HTTP at the boundary via
/// [`IntoResponse`] so handlers stay a linear `?` flow. A small enum (not a
/// boxed `Response`) keeps the `Result` cheap to pass around.
#[derive(Debug)]
pub(super) enum UploadError {
    /// Caller lacks `can_upload`/admin → 403.
    Forbidden,
    /// No ebook library path configured → 400.
    NotConfigured,
    /// Library root exists but rejects writes (read-only mount / bad
    /// permissions) → 400 with a remediation hint instead of an opaque 500.
    LibraryNotWritable,
    /// File field absent from the multipart body → 400.
    MissingFile,
    /// Title/author missing, so the file can't be placed → 400.
    MissingMetadata,
    /// File isn't a recognizable EPUB or PDF → 415.
    UnsupportedFormat,
    /// File can't be opened/parsed as an ebook → 415 (carries the reason).
    BadEbook(String),
    /// No audiobook library path configured → 400.
    AudiobookNotConfigured,
    /// Audiobook library root rejects writes → 400 with a remediation hint.
    AudiobookLibraryNotWritable,
    /// Upload isn't a recognizable `.m4a`/`.m4b`/`.mp3` audiobook → 415.
    UnsupportedAudioFormat,
    /// Audiobook parse yielded no readable tags → 415 (carries the reason).
    BadAudio(String),
    /// An upload that arrived as `.mp4` declares a `vide` track → 415. Only
    /// `.mp4` arrivals are held to this: an `.m4a`/`.m4b` may carry chapter
    /// stills as a video track and still be an audiobook.
    Mp4CarriesVideo,
    /// An ISO-BMFF upload declares no `soun` track at all → 415.
    NoAudioTrack,
    /// Upload mixed formats or sent multiple single-file containers → 400.
    MixedAudioUpload,
    /// File exceeds the configured byte cap → 413.
    TooLarge(usize),
    /// A multipart text field (title/author/series/series_index) exceeds its
    /// per-field byte cap, rejected before it's fully buffered → 413.
    FieldTooLarge { field: &'static str, cap: usize },
    /// Override validation failed (a field too long) → 400.
    Validation(String),
    /// The `overrides` field isn't a JSON `MetadataOverrides` → 400.
    BadOverrides(String),
    /// A staged cover was refused: not an image, over the image cap, or a
    /// provider URL off the allowlist / not serving an image → 400.
    BadCover(String),
    /// The provider serving a staged cover URL failed → 502, so the reader
    /// knows whose fault it was.
    CoverFetch,
    /// Unexpected internal failure → 500 (logged; detail not leaked to the wire).
    Internal {
        context: &'static str,
        detail: String,
    },
}

impl UploadError {
    fn internal(context: &'static str, e: impl std::fmt::Display) -> Self {
        UploadError::Internal {
            context,
            detail: e.to_string(),
        }
    }
}

impl IntoResponse for UploadError {
    fn into_response(self) -> Response {
        match self {
            UploadError::Forbidden => {
                (StatusCode::FORBIDDEN, "upload permission required").into_response()
            }
            UploadError::NotConfigured => (
                StatusCode::BAD_REQUEST,
                "Configure an ebook library path in Settings first",
            )
                .into_response(),
            UploadError::LibraryNotWritable => (
                StatusCode::BAD_REQUEST,
                "The ebook library is not writable — uploads need a read-write \
                 library mount (remove `:ro` from the books volume)",
            )
                .into_response(),
            UploadError::MissingFile => {
                (StatusCode::BAD_REQUEST, "missing 'file' field").into_response()
            }
            UploadError::MissingMetadata => (
                StatusCode::BAD_REQUEST,
                "title and author are required to file the book",
            )
                .into_response(),
            UploadError::UnsupportedFormat => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "file must be a valid EPUB or PDF",
            )
                .into_response(),
            UploadError::BadEbook(msg) => (StatusCode::UNSUPPORTED_MEDIA_TYPE, msg).into_response(),
            UploadError::AudiobookNotConfigured => (
                StatusCode::BAD_REQUEST,
                "Configure an audiobook library path in Settings first",
            )
                .into_response(),
            UploadError::AudiobookLibraryNotWritable => (
                StatusCode::BAD_REQUEST,
                "The audiobook library is not writable — uploads need a read-write \
                 library mount (remove `:ro` from the audiobooks volume)",
            )
                .into_response(),
            UploadError::UnsupportedAudioFormat => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "file must be a valid .m4a, .m4b, .mp4, or .mp3 audiobook",
            )
                .into_response(),
            UploadError::BadAudio(msg) => (StatusCode::UNSUPPORTED_MEDIA_TYPE, msg).into_response(),
            UploadError::Mp4CarriesVideo => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "file must be an audio-only MP4: it carries a video track",
            )
                .into_response(),
            UploadError::NoAudioTrack => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "file must be an audiobook container: it carries no audio track",
            )
                .into_response(),
            UploadError::MixedAudioUpload => (
                StatusCode::BAD_REQUEST,
                "upload one .m4a/.m4b/.mp4 audiobook, or a set of .mp3 parts for a single book",
            )
                .into_response(),
            UploadError::TooLarge(cap) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("file exceeds the {cap}-byte upload limit"),
            )
                .into_response(),
            UploadError::FieldTooLarge { field, cap } => (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("{field} exceeds the {cap}-byte limit"),
            )
                .into_response(),
            UploadError::Validation(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
            UploadError::BadOverrides(msg) => (
                StatusCode::BAD_REQUEST,
                format!("overrides must be a JSON metadata diff: {msg}"),
            )
                .into_response(),
            UploadError::BadCover(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
            UploadError::CoverFetch => (
                StatusCode::BAD_GATEWAY,
                "could not fetch the cover from that source",
            )
                .into_response(),
            UploadError::Internal { context, detail } => {
                tracing::error!(error = %detail, context = context, "internal server error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
            }
        }
    }
}

/// 403 unless the user may upload (`can_upload` or admin). Mirrors the
/// `can_edit` gate in [`super::overrides`].
fn require_upload(user: &AuthUser) -> Result<(), UploadError> {
    if user.is_admin || user.can_upload {
        Ok(())
    } else {
        Err(UploadError::Forbidden)
    }
}

/// Magic-byte + size gate for a fully-buffered upload. Intentionally kept
/// unwired: [`stream_upload_to_tempfile`] enforces the same two invariants
/// incrementally, chunk-by-chunk, specifically so an upload is never fully
/// buffered in RAM — swapping this in would mean buffering the whole file
/// first, defeating that streaming design. Kept as a unit-tested reference
/// for the two invariants the streaming path must independently uphold.
#[allow(dead_code)]
fn validate_file_bytes(bytes: &[u8], cap: usize) -> Result<(), UploadError> {
    if bytes.len() > cap {
        return Err(UploadError::TooLarge(cap));
    }
    if detect_ebook_format(bytes).is_none() {
        return Err(UploadError::UnsupportedFormat);
    }
    Ok(())
}

/// Feed the next chunk into the magic prefix. `Ok(None)` while the prefix is
/// still short of [`EBOOK_MAGIC_LEN`]; `Ok(Some(ext))` once the bytes settle
/// the format — the extension the upload is filed under.
fn extend_and_validate_magic(
    prefix: &mut Vec<u8>,
    chunk: &[u8],
) -> Result<Option<&'static str>, UploadError> {
    let needed = EBOOK_MAGIC_LEN.saturating_sub(prefix.len());
    prefix.extend_from_slice(&chunk[..chunk.len().min(needed)]);
    if prefix.len() < EBOOK_MAGIC_LEN {
        return Ok(None);
    }
    detect_ebook_format(prefix)
        .map(Some)
        .ok_or(UploadError::UnsupportedFormat)
}

/// Trim and drop empty so blank form fields read as "no value".
fn norm(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

// --- Streaming helper -------------------------------------------------------

/// A streamed upload: the tempfile holding the bytes, whose suffix is the
/// sniffed format's extension so the parser dispatches on it the way a scan
/// does, plus that extension for filing.
struct StagedUpload {
    tmp: tempfile::NamedTempFile,
    ext: &'static str,
}

/// Stream a multipart `file` field to a tempfile, enforcing the byte cap
/// incrementally and sniffing the format from the leading bytes. The
/// tempfile is created once the magic settles the extension (the first
/// chunk, in practice), so the payload is never fully buffered in RAM — only
/// one chunk is held at a time while it is written to disk.
async fn stream_upload_to_tempfile(
    mut field: Field<'_>,
    cap: usize,
) -> Result<StagedUpload, UploadError> {
    let mut staged: Option<(tempfile::NamedTempFile, tokio::fs::File, &'static str)> = None;
    let mut total = 0usize;
    let mut magic_prefix = Vec::with_capacity(EBOOK_MAGIC_LEN);
    // Bytes seen before the format settled — flushed into the tempfile the
    // moment it exists. Bounded by EBOOK_MAGIC_LEN chunks, so tiny.
    let mut pending: Vec<u8> = Vec::new();

    loop {
        let chunk = field
            .chunk()
            .await
            .map_err(|e| UploadError::internal("read upload chunk", e))?;
        let Some(chunk) = chunk else { break };
        total += chunk.len();
        if total > cap {
            return Err(UploadError::TooLarge(cap));
        }
        if staged.is_none() {
            pending.extend_from_slice(&chunk);
            let Some(ext) = extend_and_validate_magic(&mut magic_prefix, &chunk)? else {
                continue;
            };
            let tmp = tempfile::Builder::new()
                .suffix(&format!(".{ext}"))
                .tempfile()
                .map_err(|e| UploadError::internal("create upload tempfile", e))?;
            let mut f = tokio::fs::OpenOptions::new()
                .write(true)
                .open(tmp.path())
                .await
                .map_err(|e| UploadError::internal("open upload tempfile", e))?;
            f.write_all(&pending)
                .await
                .map_err(|e| UploadError::internal("write upload chunk", e))?;
            pending = Vec::new();
            staged = Some((tmp, f, ext));
            continue;
        }
        if let Some((_, f, _)) = staged.as_mut() {
            f.write_all(&chunk)
                .await
                .map_err(|e| UploadError::internal("write upload chunk", e))?;
        }
    }
    if magic_prefix.is_empty() {
        return Err(UploadError::MissingFile);
    }
    let Some((tmp, mut f, ext)) = staged else {
        return Err(UploadError::UnsupportedFormat);
    };

    // Flush + fsync before the path is handed to a separate reader (`EpubDoc`
    // in a `spawn_blocking`, or `std::fs::copy` on commit). `tokio::fs::File`
    // batches writes on a background thread pool and does NOT flush on drop, so
    // without this the parser can reopen the tempfile before the streamed writes
    // are durably visible and reads a truncated ZIP → a spurious 415. Mirrors
    // the audiobook path's `stream_audio_to_tempfile`, which already fixed the
    // same race (surfaced under CI's Linux filesystem timing).
    f.flush()
        .await
        .map_err(|e| UploadError::internal("flush upload tempfile", e))?;
    f.sync_all()
        .await
        .map_err(|e| UploadError::internal("sync upload tempfile", e))?;
    drop(f);

    Ok(StagedUpload { tmp, ext })
}

/// Read a multipart text field incrementally, capping the bytes buffered
/// before it is fully read (mirrors `stream_upload_to_tempfile`'s incremental
/// cap on the `file` field). Returns `Ok(None)` for non-UTF-8 bytes, matching
/// `field.text().await.ok()`'s prior silent-drop behavior.
async fn read_text_field_capped(
    mut field: Field<'_>,
    field_name: &'static str,
    cap: usize,
) -> Result<Option<String>, UploadError> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let chunk = field
            .chunk()
            .await
            .map_err(|e| UploadError::internal("read multipart text chunk", e))?;
        let Some(chunk) = chunk else { break };
        if buf.len() + chunk.len() > cap {
            return Err(UploadError::FieldTooLarge {
                field: field_name,
                cap,
            });
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8(buf).ok())
}

// --- Inspect ---------------------------------------------------------------

/// Parse an uploaded EPUB or PDF and return its embedded metadata for the
/// review form. Stateless: the field is streamed to a tempfile, parsed, then
/// discarded — nothing is filed or inserted until commit.
pub(super) async fn post_inspect_ebook(
    user: AuthUser,
    State(_state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Response, UploadError> {
    require_upload(&user)?;
    let field = loop {
        match multipart.next_field().await {
            Ok(Some(f)) if f.name().unwrap_or("") == "file" => break f,
            Ok(Some(_)) => continue,
            Ok(None) => return Err(UploadError::MissingFile),
            Err(e) => return Err(UploadError::internal("parse multipart", e)),
        }
    };
    let original_name = field.file_name().map(str::to_owned);
    let staged = stream_upload_to_tempfile(field, max_upload_bytes()).await?;
    let filename = upload_filename(original_name.as_deref(), staged.ext);
    // Parsing opens the archive / page tree — run it off the async runtime.
    let inspection = tokio::task::spawn_blocking(move || inspect_ebook_tempfile(&staged, filename))
        .await
        .map_err(|e| UploadError::internal("spawn_blocking(inspect ebook)", e))??;
    Ok(Json(inspection).into_response())
}

/// The name the parser sees for an inspected upload: the client's own file
/// name, reduced to its stem, under the sniffed extension. The parsers fall
/// back to that stem for a title when the file embeds none — a PDF with no
/// Info dict, a CBZ without `ComicInfo.xml` — so a synthetic name here
/// would surface as the book's title in the review form. Only the last
/// path component is kept: the name is never used to place the file, but
/// a stem is what the reader will see.
fn upload_filename(original: Option<&str>, ext: &str) -> String {
    let base = original
        .map(|name| name.rsplit(['/', '\\']).next().unwrap_or(name))
        .map(str::trim)
        .unwrap_or("");
    // Not `Path::file_stem`: it reads a bare `.pdf` as a dotfile with no
    // extension and would hand that back as the stem.
    let stem = base.rsplit_once('.').map_or(base, |(stem, _)| stem).trim();
    let stem = if stem.is_empty() { "upload" } else { stem };
    format!("{stem}.{ext}")
}

/// Parse the already-written upload with the indexer's own parser for its
/// sniffed format and project the result into an [`UploadInspection`]. Parse
/// failures map to 415; staging IO failures to 500. `filename` is the name
/// from [`upload_filename`], which the parser reads for its title fallback.
fn inspect_ebook_tempfile(
    staged: &StagedUpload,
    filename: String,
) -> Result<UploadInspection, UploadError> {
    let size_bytes = std::fs::metadata(staged.tmp.path())
        .map_err(|e| UploadError::internal("stat upload tempfile", e))?
        .len() as i64;
    let label = staged.ext.to_ascii_uppercase();
    let targets = vec![db::ebook::ParseTarget {
        filename,
        absolute: staged.tmp.path().to_path_buf(),
        mtime_epoch: 0,
        size_bytes,
    }];
    let mut parsed = db::ebook::parse_ebook_targets(targets, db::ebook::ScanOptions::default());
    let book = parsed
        .pop()
        .ok_or_else(|| UploadError::BadEbook(format!("could not parse {label}")))?;
    if let Some(err) = book.metadata.error {
        return Err(UploadError::BadEbook(format!(
            "could not parse {label}: {err}"
        )));
    }
    let meta = book.metadata;
    Ok(UploadInspection {
        title: meta.title,
        author: meta.creators.first().map(|c| c.name.clone()),
        creators: meta.creators.iter().map(|c| c.name.clone()).collect(),
        series: meta.series,
        series_index: meta.series_index,
        language: meta.language,
        has_cover: book.cover.is_some(),
        ext: staged.ext.to_string(),
        description: meta.description,
        publisher: meta.publisher,
        published: meta.published,
        subjects: meta.subjects,
        // The parser leaves this for the read-time projection; the form
        // needs it now, derived the same way.
        isbn13: db::derive_isbn13(&meta.identifiers),
        identifiers: meta.identifiers,
        cover_preview: book
            .cover
            .as_ref()
            .and_then(|(_, bytes)| review::cover_preview_data_url(bytes)),
    })
}

// --- Commit ----------------------------------------------------------------

/// The user's (possibly edited) metadata parsed from the commit multipart body,
/// plus the staged upload holding the already-streamed bytes.
#[derive(Default)]
struct CommitForm {
    tmp_file: Option<StagedUpload>,
    legacy: LegacyFields,
    extras: CommitExtras,
}

/// The creators to save when the review form's Author differs from the file's
/// first creator. The form edits the first *name* only (#2355): that creator
/// keeps its role and file-as form, and the others the file declared ride
/// along unchanged, so correcting a garbled lead author never drops a
/// co-author or a refinement. The `id` is cleared because the renamed
/// contributor no longer denotes the author row the file's name resolved to.
pub(super) fn edited_creators(first: String, embedded: &[Contributor]) -> Vec<Contributor> {
    let mut lead = embedded.first().cloned().unwrap_or_default();
    lead.name = first;
    lead.id = None;
    std::iter::once(lead)
        .chain(embedded.iter().skip(1).cloned())
        .collect()
}

/// File the uploaded EPUB or PDF into the canonical library folder using the
/// user's confirmed title/author, reindex so the indexer inserts the book,
/// then layer the review edits and any staged cover onto it. Returns 201
/// with the new book's uuid.
///
/// Everything that can be refused — the overrides diff, a staged cover's
/// bytes or its provider fetch — is settled *before* the file is placed, so
/// a rejected review never leaves a file in the library.
pub(super) async fn post_upload_ebook(
    user: AuthUser,
    State(state): State<AppState>,
    multipart: Multipart,
) -> Result<Response, UploadError> {
    require_upload(&user)?;
    let mut form = parse_commit_multipart(multipart, max_upload_bytes()).await?;
    let StagedUpload { tmp, ext } = form.tmp_file.take().ok_or(UploadError::MissingFile)?;
    let (Some(title), Some(author)) = (norm(&form.legacy.title), norm(&form.legacy.author)) else {
        return Err(UploadError::MissingMetadata);
    };
    review::validate_review(&form.legacy, &form.extras)?;
    let cover = review::resolve_staged_cover(&state, &mut form.extras).await?;

    // Library root must be configured before any file can be placed.
    let settings = db::get_settings(&state.pool)
        .await
        .map_err(|e| UploadError::internal("get_settings", e))?;
    let root = settings
        .ebook_library_path
        .filter(|p| !p.is_empty())
        .ok_or(UploadError::NotConfigured)?;

    // Allocate a non-colliding canonical path and copy the tempfile there.
    let root_path = PathBuf::from(&root);
    let dest = library_layout::allocate_canonical_path(&root_path, &author, &title, ext)
        .map_err(|e| UploadError::internal("allocate_canonical_path", e))?;
    copy_uploaded_ebook_to_library(&dest, tmp).await?;

    let uuid = match reindex_and_resolve_uploaded_uuid(&state, &root, &root_path, &dest).await {
        Ok(uuid) => uuid,
        Err(e) => {
            // Don't strand a file whose scan or lookup failed.
            let _ = tokio::fs::remove_file(&dest).await;
            return Err(e);
        }
    };

    // Make the displayed metadata match what the user confirmed. A failure
    // here undoes the book: the client sees an error, so nothing may stay.
    let scan_key = scan_key_of(&root_path, &dest);
    let finished = review::finish_upload(
        &state,
        &uuid,
        &scan_key,
        user.id,
        &form.legacy,
        form.extras.overrides.take(),
        cover,
    )
    .await;
    if let Err(e) = finished {
        review::rollback_uploaded_file(&state, &uuid, &scan_key).await;
        let _ = tokio::fs::remove_file(&dest).await;
        return Err(e);
    }

    Ok((StatusCode::CREATED, Json(UploadCommitResult { uuid })).into_response())
}

/// Copy the streamed-to-tempfile upload (EPUB or PDF) to its final canonical `dest`,
/// creating parent directories as needed. The tempfile is deleted as a side
/// effect of `tmp` dropping once the blocking closure returns.
async fn copy_uploaded_ebook_to_library(
    dest: &Path,
    tmp: tempfile::NamedTempFile,
) -> Result<(), UploadError> {
    let dest_for_copy = dest.to_path_buf();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        if let Some(parent) = dest_for_copy.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(tmp.path(), &dest_for_copy).map(|_| ())?;
        // tmp drops here, deleting the upload tempfile.
        Ok(())
    })
    .await
    .map_err(|e| UploadError::internal("spawn_blocking(file ebook)", e))?
    .map_err(|e| match e.kind() {
        std::io::ErrorKind::ReadOnlyFilesystem | std::io::ErrorKind::PermissionDenied => {
            tracing::warn!(error = %e, dest = %dest.display(), "ebook library is not writable");
            UploadError::LibraryNotWritable
        }
        _ => UploadError::internal("file uploaded ebook", e),
    })
}

/// Reindex the library so the indexer mints the uuid, extracts the cover,
/// and updates FTS — the single source of truth for inserting books — then
/// map the just-placed file back to its row via the durable scan_key.
async fn reindex_and_resolve_uploaded_uuid(
    state: &AppState,
    root: &str,
    root_path: &Path,
    dest: &Path,
) -> Result<String, UploadError> {
    let task_id = state.worker.post(Task::Scan {
        library_path: root.to_string(),
    });
    if let TaskOutcome::Err(e) = state.worker.await_completion(task_id).await {
        return Err(UploadError::internal("reindex after upload", e));
    }

    let scan_key = scan_key_of(root_path, dest);
    db::get_book_uuid_by_scan_key(&state.pool, root, &scan_key)
        .await
        .map_err(|e| UploadError::internal("get_book_uuid_by_scan_key", e))?
        .ok_or_else(|| {
            UploadError::internal(
                "resolve uploaded book",
                "reindex did not surface the uploaded file",
            )
        })
}

/// Library-relative path of `dest` under `root_path` — the durable scan_key
/// the reindex records for the placed file.
fn scan_key_of(root_path: &Path, dest: &Path) -> String {
    dest.strip_prefix(root_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Collect the user's text fields, the review fields, and stream the file
/// field to a tempfile.
async fn parse_commit_multipart(
    mut multipart: Multipart,
    cap: usize,
) -> Result<CommitForm, UploadError> {
    let mut form = CommitForm::default();
    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let name = field.name().unwrap_or("").to_string();
                match name.as_str() {
                    "file" => {
                        form.tmp_file = Some(stream_upload_to_tempfile(field, cap).await?);
                    }
                    "title" => {
                        form.legacy.title =
                            read_text_field_capped(field, "title", MAX_TEXT_FIELD_BYTES).await?
                    }
                    "author" => {
                        form.legacy.author =
                            read_text_field_capped(field, "author", MAX_TEXT_FIELD_BYTES).await?
                    }
                    "series" => {
                        form.legacy.series =
                            read_text_field_capped(field, "series", MAX_TEXT_FIELD_BYTES).await?
                    }
                    "series_index" => {
                        form.legacy.series_index =
                            read_text_field_capped(field, "series_index", MAX_TEXT_FIELD_BYTES)
                                .await?
                    }
                    other => {
                        review::take_extra_field(&mut form.extras, other, field).await?;
                    }
                }
            }
            Ok(None) => break,
            Err(e) => return Err(UploadError::internal("parse multipart", e)),
        }
    }
    Ok(form)
}

mod audiobooks;
mod review;
pub(super) use audiobooks::{post_inspect_audiobook, post_upload_audiobook};

#[cfg(test)]
mod tests;
