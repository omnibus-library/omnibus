//! The review half of a commit, shared by the ebook and audiobook handlers:
//! the review form's extra multipart fields (overrides diff, picked cover,
//! provider cover URL), the cover resolution that runs before the file is
//! placed, the finish step that layers edits and cover onto the indexed
//! book, and the rollback that undoes the book when that step fails.

use axum::{body::Bytes, extract::multipart::Field};
use omnibus_db as db;
use omnibus_shared::{
    commit_fields, detect_image_format, EbookMetadata, ExternalBookMeta, MetadataOverrides,
};

use super::{edited_creators, norm, read_text_field_capped, UploadError};
use crate::backend::{image_upload, overrides, AppState};

/// The inspected file's cover as a small inline `data:` URL for the review
/// form, or `None` when it can't be decoded — the form then shows the plate
/// and the indexer, which tolerates more, still extracts the real cover on
/// commit. Runs on the caller's blocking thread alongside the parse.
pub(super) fn cover_preview_data_url(cover_bytes: &[u8]) -> Option<String> {
    match db::thumbs::cover_preview_data_url(cover_bytes) {
        Ok(url) => Some(url),
        Err(e) => {
            tracing::debug!(error = %e, "upload inspect: cover preview skipped");
            None
        }
    }
}

/// Cap for the `overrides` JSON field. A description alone may run to
/// `MetadataOverrides::DESCRIPTION_MAX_LEN` chars, so the 8 KiB the legacy
/// text fields get is not enough here.
pub(super) const MAX_OVERRIDES_FIELD_BYTES: usize = 256 * 1024;

/// What the review form adds to a commit beyond the file and the legacy
/// text fields. All optional: the iOS client sends none of them.
#[derive(Default)]
pub(super) struct CommitExtras {
    /// The form's diff against the inspection. Layered over the legacy
    /// fields and pruned back to what differs from the indexed row.
    pub(super) overrides: Option<MetadataOverrides>,
    /// An image picked from disk, already sniffed to its real MIME.
    pub(super) cover: Option<(String, Bytes)>,
    /// A provider's cover URL from the edition picker.
    pub(super) cover_url: Option<String>,
}

/// The four text fields both commit forms have always carried. `title` and
/// `author` still decide the on-disk folder; the review form sends them
/// alongside its `overrides` so an older server files the book the same way.
#[derive(Default)]
pub(super) struct LegacyFields {
    pub(super) title: Option<String>,
    pub(super) author: Option<String>,
    pub(super) series: Option<String>,
    pub(super) series_index: Option<String>,
}

/// Consume `field` when it is one of the review fields. `Ok(false)` when it
/// isn't, so the caller's own `match` keeps handling the rest.
pub(super) async fn take_extra_field(
    extras: &mut CommitExtras,
    name: &str,
    field: Field<'_>,
) -> Result<bool, UploadError> {
    match name {
        commit_fields::OVERRIDES => {
            let raw = read_text_field_capped(field, "overrides", MAX_OVERRIDES_FIELD_BYTES)
                .await?
                .ok_or_else(|| UploadError::BadOverrides("overrides must be UTF-8 JSON".into()))?;
            extras.overrides = Some(
                serde_json::from_str(&raw).map_err(|e| UploadError::BadOverrides(e.to_string()))?,
            );
        }
        commit_fields::COVER => {
            extras.cover = Some(image_upload::read_image_field(field).await.map_err(
                |e| match e {
                    image_upload::ImageFieldError::Read(detail) => {
                        UploadError::internal("read cover field", detail)
                    }
                    other => UploadError::BadCover(other.message("cover")),
                },
            )?);
        }
        commit_fields::COVER_URL => {
            extras.cover_url =
                read_text_field_capped(field, "cover_url", ExternalBookMeta::COVER_URL_MAX_LEN)
                    .await?
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// Reject anything a save would reject, before any file is placed: the
/// review diff, and the legacy text fields measured as the overrides they
/// become — a 501-character title must fail here, not after the reindex.
pub(super) fn validate_review(
    legacy: &LegacyFields,
    extras: &CommitExtras,
) -> Result<(), UploadError> {
    legacy_overrides(&EbookMetadata::default(), legacy)
        .validate()
        .map_err(UploadError::Validation)?;
    if let Some(ov) = &extras.overrides {
        ov.validate().map_err(UploadError::Validation)?;
    }
    Ok(())
}

/// The bytes to write as the new book's cover, settled before the file is
/// placed: a picked image as-is, or a provider URL fetched under the
/// cover-from-URL route's terms (HTTPS, catalog hosts, no private
/// addresses, size cap) and sniffed, because a provider serving an HTML
/// error page under `image/jpeg` must not become a cover.
pub(super) async fn resolve_staged_cover(
    state: &AppState,
    extras: &mut CommitExtras,
) -> Result<Option<(String, Bytes)>, UploadError> {
    if let Some(cover) = extras.cover.take() {
        return Ok(Some(cover));
    }
    let Some(url) = extras.cover_url.take() else {
        return Ok(None);
    };
    let config = overrides::cover_fetch_config(state);
    let (advertised_mime, bytes) = match db::fetch_provider_cover(&url, &config).await {
        Ok(pair) => pair,
        Err(db::author_photos::FetchRemoteImageError::Http(e)) => {
            tracing::warn!(error = ?e, "staged provider cover fetch failed");
            return Err(UploadError::CoverFetch);
        }
        // A refusal we made: bad scheme, host off the allowlist, blocked
        // address, non-image content-type, too large.
        Err(e) => return Err(UploadError::BadCover(e.to_string())),
    };
    let Some(mime) = detect_image_format(&bytes) else {
        tracing::warn!(
            advertised_mime,
            "staged cover URL returned image content-type but bytes are not an image"
        );
        return Err(UploadError::BadCover(
            "file at URL does not appear to be a valid image".into(),
        ));
    };
    Ok(Some((mime, Bytes::from(bytes))))
}

/// Layer what the reader confirmed onto the freshly indexed book: the legacy
/// fields, the review diff on top of them, pruned back to what actually
/// differs from the indexed row, then the staged cover. A book accepted
/// as-is ends up with no override at all, so it keeps following its file.
///
/// The indexer may have *attached* the upload to an existing book in
/// another format rather than minting one (`scan_key` is then not the
/// book's own). That book's record is not the upload's: the legacy
/// title/author only ever named the folder, so they are not applied to it —
/// only the edits the reader made on the form are. And whatever this writes,
/// a failure part-way puts the book's override row back as it was, so a
/// request the client saw fail changes nothing on a book that already
/// existed (the handler then removes the file itself).
pub(super) async fn finish_upload(
    state: &AppState,
    uuid: &str,
    scan_key: &str,
    user_id: i64,
    legacy: &LegacyFields,
    review: Option<MetadataOverrides>,
    cover: Option<(String, Bytes)>,
) -> Result<(), UploadError> {
    let book = db::get_book_by_uuid(&state.pool, uuid)
        .await
        .map_err(|e| UploadError::internal("get_book_by_uuid", e))?
        .ok_or_else(|| UploadError::internal("get_book_by_uuid after upload", "book vanished"))?;
    let files = db::get_book_files(&state.pool, book.id)
        .await
        .map_err(|e| UploadError::internal("get_book_files", e))?;
    let attached = files.iter().any(|f| f.path.as_deref() != Some(scan_key));
    let prior = db::get_metadata_overrides(&state.pool, uuid)
        .await
        .map_err(|e| UploadError::internal("get_metadata_overrides", e))?;
    // `persist_cover` replaces the override file before its row write can
    // fail, so a book that already had one is snapshotted byte-for-byte.
    let prior_cover = match (&prior, &cover) {
        (Some((_, true)), Some(_)) => db::get_cover(&state.pool, book.id)
            .await
            .map_err(|e| UploadError::internal("get_cover", e))?,
        _ => None,
    };

    let written = apply_review(state, &book, user_id, legacy, review, cover, attached).await;
    if let Err(e) = written {
        restore_overrides(state, uuid, user_id, prior, prior_cover).await;
        return Err(e);
    }
    Ok(())
}

/// The writes [`finish_upload`] snapshots around.
async fn apply_review(
    state: &AppState,
    book: &EbookMetadata,
    user_id: i64,
    legacy: &LegacyFields,
    review: Option<MetadataOverrides>,
    cover: Option<(String, Bytes)>,
    attached: bool,
) -> Result<(), UploadError> {
    let uuid = book.unique_identifier.as_deref().unwrap_or_default();
    let mut overrides = if attached {
        MetadataOverrides::default()
    } else {
        legacy_overrides(book, legacy)
    };
    if let Some(review) = review {
        layer(&mut overrides, review);
    }
    trim_scalars(&mut overrides);
    prune_unchanged(&mut overrides, book);

    if overrides != MetadataOverrides::default() {
        overrides.validate().map_err(UploadError::Validation)?;
        db::merge_metadata_overrides(&state.pool, uuid, &overrides, user_id)
            .await
            .map_err(|e| UploadError::internal("merge_metadata_overrides", e))?;
    }

    if let Some((mime, bytes)) = cover {
        overrides::persist_cover(state, uuid, user_id, mime, bytes)
            .await
            .map_err(|e| UploadError::Internal {
                context: e.context,
                detail: e.detail,
            })?;
        let id = book.id;
        tokio::task::spawn_blocking(move || db::thumbs::invalidate_thumbs(id))
            .await
            .map_err(|e| UploadError::internal("spawn_blocking(invalidate_thumbs)", e))?;
    }
    Ok(())
}

/// Put a book's override row — and its override cover file — back to what
/// [`finish_upload`] read before it wrote anything, after a failed finish.
/// A row that did not exist is deleted again; a cover override this request
/// wrote over a book that had none is removed, and one it wrote over a
/// book that had its own is overwritten with the snapshotted bytes.
/// Best-effort, like the file rollback: the original error is what the
/// client gets.
pub(super) async fn restore_overrides(
    state: &AppState,
    uuid: &str,
    user_id: i64,
    prior: Option<(MetadataOverrides, bool)>,
    prior_cover: Option<(String, Vec<u8>)>,
) {
    let result = match &prior {
        Some((ov, had_cover)) => {
            db::upsert_metadata_overrides(&state.pool, uuid, ov, *had_cover, user_id).await
        }
        None => db::delete_metadata_overrides(&state.pool, uuid).await,
    };
    if let Err(e) = result {
        tracing::error!(uuid, error = %e, "upload rollback: could not restore the override row");
    }
    let had_cover = prior.is_some_and(|(_, had_cover)| had_cover);
    let uuid = uuid.to_string();
    let cover_restore = tokio::task::spawn_blocking(move || match (had_cover, prior_cover) {
        (true, Some((mime, bytes))) => {
            db::write_override_cover(&uuid, &mime, &bytes).map_err(|e| e.to_string())
        }
        (true, None) => Ok(()),
        (false, _) => {
            db::delete_override_cover(&uuid);
            Ok(())
        }
    })
    .await;
    match cover_restore {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            tracing::error!(error = %e, "upload rollback: could not restore the override cover")
        }
        Err(e) => tracing::warn!(error = %e, "upload rollback: override cover restore join failed"),
    }
}

/// Undo a commit whose finish step failed after the reindex: delete the
/// file row the scan recorded under `scan_key` — and, when that was the
/// book's only file, the book itself with its covers — so a request the
/// client saw fail did not quietly add a book. Keyed on the uploaded file
/// rather than the uuid because the indexer may have *attached* the upload
/// to an existing book in another format; that book keeps everything it
/// had. Best-effort: the original error is what the client gets, and a
/// rollback failure is logged beside it rather than replacing it.
pub(super) async fn rollback_uploaded_file(state: &AppState, uuid: &str, scan_key: &str) {
    let file_ids: Vec<i64> = match db::resolve_book_id_by_uuid(&state.pool, uuid).await {
        Ok(Some(id)) => match db::get_book_files(&state.pool, id).await {
            Ok(files) => files
                .into_iter()
                .filter(|f| f.path.as_deref() == Some(scan_key))
                .map(|f| f.id)
                .collect(),
            Err(e) => {
                tracing::error!(uuid, error = %e, "upload rollback: could not list the book's files");
                return;
            }
        },
        Ok(None) => return,
        Err(e) => {
            tracing::error!(uuid, error = %e, "upload rollback: could not resolve the book");
            return;
        }
    };
    if file_ids.is_empty() {
        tracing::error!(
            uuid,
            scan_key,
            "upload rollback: the scan recorded no file under this key"
        );
        return;
    }
    match db::delete_book_items(&state.pool, uuid, &file_ids, &[]).await {
        Ok(outcome) if outcome.book_deleted => {
            tracing::warn!(
                uuid,
                "upload rollback: removed the book the failed commit created"
            )
        }
        Ok(_) => tracing::warn!(
            uuid,
            scan_key,
            "upload rollback: removed the uploaded file from a book it was attached to"
        ),
        Err(e) => tracing::error!(uuid, error = %e, "upload rollback failed"),
    }
}

/// Trim every scalar the diff carries. The legacy title/author are trimmed
/// before they decide the folder; the review diff must not then store the
/// untrimmed spelling of the same field as the effective value.
pub(super) fn trim_scalars(overrides: &mut MetadataOverrides) {
    let scalars = [
        &mut overrides.title,
        &mut overrides.description,
        &mut overrides.publisher,
        &mut overrides.published,
        &mut overrides.language,
        &mut overrides.series,
        &mut overrides.series_index,
        &mut overrides.isbn13,
        &mut overrides.isbn10,
    ];
    for v in scalars.into_iter().flatten() {
        let trimmed = v.trim();
        if trimmed.len() != v.len() {
            *v = trimmed.to_string();
        }
    }
    for c in overrides.creators.iter_mut().flatten() {
        let trimmed = c.name.trim();
        if trimmed.len() != c.name.len() {
            c.name = trimmed.to_string();
        }
    }
}

/// The legacy four fields as overrides, each only where it differs from the
/// indexed value. The form edits the first creator's *name* only (#2355):
/// that creator keeps its role and file-as form, and the others ride along.
pub(super) fn legacy_overrides(book: &EbookMetadata, legacy: &LegacyFields) -> MetadataOverrides {
    let mut overrides = MetadataOverrides::default();
    if let Some(title) = norm(&legacy.title) {
        if book.title.as_deref() != Some(title.as_str()) {
            overrides.title = Some(title);
        }
    }
    if let Some(author) = norm(&legacy.author) {
        let embedded = book.creators.first().map(|c| c.name.as_str());
        if embedded != Some(author.as_str()) {
            overrides.creators = Some(edited_creators(author, &book.creators));
        }
    }
    if let Some(series) = norm(&legacy.series) {
        if book.series.as_deref() != Some(series.as_str()) {
            overrides.series = Some(series);
        }
    }
    if let Some(series_index) = norm(&legacy.series_index) {
        if book.series_index.as_deref() != Some(series_index.as_str()) {
            overrides.series_index = Some(series_index);
        }
    }
    overrides
}

/// Every field the review diff set wins over the legacy field for it; a
/// field it left `None` keeps whatever the legacy fields produced.
fn layer(base: &mut MetadataOverrides, review: MetadataOverrides) {
    let MetadataOverrides {
        title,
        description,
        publisher,
        published,
        language,
        series,
        series_index,
        isbn13,
        isbn10,
        creators,
        subjects,
        genres,
        print_pages,
    } = review;
    base.title = title.or(base.title.take());
    base.description = description.or(base.description.take());
    base.publisher = publisher.or(base.publisher.take());
    base.published = published.or(base.published.take());
    base.language = language.or(base.language.take());
    base.series = series.or(base.series.take());
    base.series_index = series_index.or(base.series_index.take());
    base.isbn13 = isbn13.or(base.isbn13.take());
    base.isbn10 = isbn10.or(base.isbn10.take());
    base.creators = creators.or(base.creators.take());
    base.subjects = subjects.or(base.subjects.take());
    base.genres = genres.or(base.genres.take());
    base.print_pages = print_pages.or(base.print_pages.take());
}

/// Drop every override that restates the indexed value. The review form
/// diffs against the *inspection*, which the same parser produced, so this
/// is normally a no-op — but it is what makes "an unedited field leaves no
/// override" a guarantee rather than a property of one client.
pub(super) fn prune_unchanged(overrides: &mut MetadataOverrides, book: &EbookMetadata) {
    // An override of `""` clears a scanned value; against a book that has
    // none it is a no-op and goes.
    let same = |ov: &Option<String>, scanned: &Option<String>| {
        ov.as_deref() == Some(scanned.as_deref().unwrap_or(""))
    };
    if same(&overrides.title, &book.title) {
        overrides.title = None;
    }
    if same(&overrides.description, &book.description) {
        overrides.description = None;
    }
    if same(&overrides.publisher, &book.publisher) {
        overrides.publisher = None;
    }
    if same(&overrides.published, &book.published) {
        overrides.published = None;
    }
    if same(&overrides.language, &book.language) {
        overrides.language = None;
    }
    if same(&overrides.series, &book.series) {
        overrides.series = None;
    }
    if same(&overrides.series_index, &book.series_index) {
        overrides.series_index = None;
    }
    if same(&overrides.isbn13, &book.isbn13) {
        overrides.isbn13 = None;
    }
    if same(&overrides.isbn10, &book.isbn10) {
        overrides.isbn10 = None;
    }
    let scanned_names: Vec<&str> = book.creators.iter().map(|c| c.name.as_str()).collect();
    if overrides.creators.as_ref().is_some_and(|c| {
        c.iter()
            .map(|c| c.name.as_str())
            .eq(scanned_names.iter().copied())
    }) {
        overrides.creators = None;
    }
    if overrides.subjects.as_deref() == Some(book.subjects.as_slice()) {
        overrides.subjects = None;
    }
    if overrides.genres.as_deref() == Some(book.genres.as_slice()) {
        overrides.genres = None;
    }
    if overrides.print_pages.is_some() && overrides.print_pages == book.print_pages {
        overrides.print_pages = None;
    }
}
