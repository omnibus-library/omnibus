//! Audiobook streaming routes: direct-play manifest (`/manifest`) + Range-
//! served part files (`/parts/{ordinal}`), with the legacy HLS pipeline
//! (`/playlist.m3u8`, `/segments/{segment}`, `/status`) retained as a
//! fallback for non-natively-playable codecs. See
//! [`get_audiobook_manifest`] for the direct-vs-HLS routing rule.

use axum::{
    extract::{Path, Query, Request, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    audiobook::{self, PlaybackMode},
    hls,
    progress::ProgressError,
    worker::Task,
};
use omnibus_shared::{
    AudiobookDownloadQuery, AudiobookManifest, AudiobookPlaybackRateRecord,
    AudiobookPlaybackRateUpdate, AudiobookStatus, AudiobookStatusState, ManifestPart,
    ManifestQuery, PartsQuery,
};

use super::{internal, AppState};
use crate::auth::{AuthUser, MediaAuthUser};

/// Content-Type for MPEG-TS audio segments served by the HLS fallback.
const MPEGTS_CONTENT_TYPE: &str = "video/MP2T";

/// Get your playback speed for a book
///
/// The speed you last saved for this audiobook, or `null` when you haven't saved one.
#[utoipa::path(
    get,
    path = "/api/audiobooks/{uuid}/playback-rate",
    tag = "Audiobooks",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "Your saved speed, or `null`.", body = Option<AudiobookPlaybackRateRecord>),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_playback_rate(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match omnibus_db::progress::get_playback_rate(&state.pool, user.id, &uuid).await {
        Ok(record) => Json(record).into_response(),
        Err(ProgressError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        Err(ProgressError::Sqlx(e)) => internal("get_playback_rate", e),
    }
}

/// Save your playback speed for a book
///
/// Saves the speed you play this audiobook at, from 0.5 to 3.0.
#[utoipa::path(
    put,
    path = "/api/audiobooks/{uuid}/playback-rate",
    tag = "Audiobooks",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = AudiobookPlaybackRateUpdate,
    responses(
        (status = 200, description = "The speed as saved.", body = AudiobookPlaybackRateRecord),
        (status = 400, description = "`playback_rate` isn't between 0.5 and 3.0."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn put_playback_rate(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(update): Json<AudiobookPlaybackRateUpdate>,
) -> Response {
    if let Err(message) = update.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, message).into_response();
    }
    match omnibus_db::progress::set_playback_rate(&state.pool, user.id, &uuid, &update).await {
        Ok(record) => Json(record).into_response(),
        Err(ProgressError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        Err(ProgressError::Sqlx(e)) => internal("set_playback_rate", e),
    }
}

/// Get an audiobook's HLS playlist
///
/// The HLS playlist for an audiobook in a format a browser can't play directly: the
/// manifest's `playlist_url` points here. It lists every segment the transcode makes, so
/// you can start playing before the transcode finishes.
#[utoipa::path(
    get,
    path = "/api/audiobooks/{uuid}/playlist.m3u8",
    tag = "Audiobooks",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The playlist.", body = String, content_type = "application/vnd.apple.mpegurl"),
        (status = 404, description = "No book with that uuid has an audio file."),
    ),
)]
pub(super) async fn get_audiobook_playlist(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    let resolved = match hls::resolve_audiobook(&state.pool, &uuid).await {
        Ok(Some(r)) => r,
        Ok(None) => return axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_audiobook", e),
    };

    // Before the transcode completes, the playlist is built from the stored
    // `book_file_parts.duration_seconds`, with no filesystem read. Once it is complete, ffmpeg's own `index.m3u8` is the
    // source of truth — its segment count matches what's actually on
    // disk, which the DB-built manifest (rounded from
    // `book_file_parts.duration_seconds`) can miss by ±1 because
    // `-hls_time 10` is advisory (keyframe / packet boundaries). Falling
    // back to the DB-built stub when the file is missing (eviction race,
    // permissions) keeps the manifest available pre-transcode too.
    let m3u8 = if hls::is_ready(resolved.book_id, hls::AUDIO64) {
        match hls::read_ffmpeg_manifest(resolved.book_id, hls::AUDIO64) {
            Some(s) => s,
            None => {
                let parts = match hls::get_parts(&state.pool, resolved.book_file_id).await {
                    Ok(p) => p,
                    Err(e) => return internal("get_parts", e),
                };
                hls::build_manifest(&parts)
            }
        }
    } else {
        let parts = match hls::get_parts(&state.pool, resolved.book_file_id).await {
            Ok(p) => p,
            Err(e) => return internal("get_parts", e),
        };
        hls::build_manifest(&parts)
    };
    (
        axum::http::StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            "application/vnd.apple.mpegurl",
        )],
        m3u8,
    )
        .into_response()
}

/// Get an audiobook's playback manifest
///
/// How to play the audiobook. When every part file is a format a browser plays natively
/// (M4B, M4A, MP3 or AAC), `mode` is `direct`: a URL per part, each streamed with `Range`,
/// plus the chapters. Otherwise `mode` is `hls`, with the URL of a playlist that plays
/// through a server-side transcode. `file_id` picks one of a book's several audio files.
#[utoipa::path(
    get,
    path = "/api/audiobooks/{uuid}/manifest",
    tag = "Audiobooks",
    params(("uuid" = String, Path, description = "The book's uuid."), ManifestQuery),
    responses(
        (status = 200, description = "The manifest.", body = AudiobookManifest),
        (status = 404, description = "No book with that uuid has an audio file, `file_id` isn't one of its audio files, or the file has no parts indexed."),
    ),
)]
pub(super) async fn get_audiobook_manifest(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(query): Query<ManifestQuery>,
) -> Response {
    // `resolve_audiobook_file` admits only M4B / M4A / MP3 rows; the direct-vs-HLS
    // split below goes by the part filenames (`audiobook::classify_filenames`).
    let resolved = match hls::resolve_audiobook_file(&state.pool, &uuid, query.file_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_audiobook", e),
    };
    let parts = match hls::get_parts(&state.pool, resolved.book_file_id).await {
        Ok(p) => p,
        Err(e) => return internal("get_parts", e),
    };
    if parts.is_empty() {
        // Indexer somehow produced a book_files row with zero parts —
        // either a migration left the audiobook in a half-state or a
        // mid-flight reindex was interrupted. Don't speculate; 404 so
        // the user clicks Reindex.
        return axum::http::StatusCode::NOT_FOUND.into_response();
    }

    // How many audio files the book carries rides along so clients know
    // whether a stored position needs a `book_file_id` to be meaningful.
    let audio_file_count = match hls::count_audio_files(&state.pool, resolved.book_id).await {
        Ok(count) => count,
        Err(e) => return internal("count_audio_files", e),
    };

    // The next file in ordinal order (sequence playback's auto-advance
    // target). Absent on the last file — and suppressed entirely when the
    // requesting user's link says the files are separate narrations, where
    // "next" would replay the same book in another voice.
    let next_file_id = match next_sequence_file_id(
        &state.pool,
        user.id,
        &uuid,
        resolved.book_id,
        resolved.book_file_id,
    )
    .await
    {
        Ok(next) => next,
        Err(e) => return internal("next_sequence_file_id", e),
    };

    let filenames: Vec<&str> = parts.iter().map(|p| p.filename.as_str()).collect();
    let file_id_suffix = query
        .file_id
        .map(|fid| format!("?file_id={fid}"))
        .unwrap_or_default();
    let manifest = match audiobook::classify_filenames(&filenames) {
        PlaybackMode::Direct => {
            let total_duration_seconds = parts.iter().map(|p| p.duration_seconds).sum();
            let manifest_parts = parts
                .iter()
                .map(|p| ManifestPart {
                    ordinal: p.ordinal,
                    url: format!(
                        "/api/audiobooks/{uuid}/parts/{}{}",
                        p.ordinal, file_id_suffix
                    ),
                    duration_seconds: p.duration_seconds,
                    mime: audiobook::mime_for_filename(&p.filename).to_string(),
                })
                .collect();
            let chapters = match hls::get_chapters(&state.pool, resolved.book_file_id).await {
                Ok(c) => c,
                Err(e) => return internal("get_chapters", e),
            };
            AudiobookManifest::Direct {
                book_file_id: resolved.book_file_id,
                audio_file_count,
                next_file_id,
                parts: manifest_parts,
                total_duration_seconds,
                chapters,
            }
        }
        PlaybackMode::Hls => AudiobookManifest::Hls {
            book_file_id: resolved.book_file_id,
            audio_file_count,
            next_file_id,
            playlist_url: format!("/api/audiobooks/{uuid}/playlist.m3u8"),
        },
    };

    Json(manifest).into_response()
}

/// The next audio file in ordinal order after `book_file_id`, or `None`
/// on the last file — and `None` when this user's cross-format link says
/// the files are separate narrations (each file IS the whole book, so
/// auto-advancing would replay it in another voice).
async fn next_sequence_file_id(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    book_uuid: &str,
    book_id: i64,
    book_file_id: i64,
) -> anyhow::Result<Option<i64>> {
    if let Some(link) = omnibus_db::cross_format::get_link(pool, user_id, book_uuid).await? {
        if link.mode == omnibus_shared::CrossFormatLinkMode::Narrations {
            return Ok(None);
        }
    }
    Ok(sqlx::query_scalar(
        "SELECT id FROM book_files
         WHERE book_id = ? AND format IN ('M4B', 'M4A', 'MP3')
           AND ordinal > (SELECT ordinal FROM book_files WHERE id = ?)
         ORDER BY ordinal LIMIT 1",
    )
    .bind(book_id)
    .bind(book_file_id)
    .fetch_optional(pool)
    .await
    .map(|row: Option<i64>| row)?)
}

/// Stream an audiobook part
///
/// One part file of an audiobook the manifest plays as `direct`, served inline for an
/// `<audio>` element. Use the part URLs from the manifest, which carry `file_id` when it
/// is needed. Answers `Range` requests, so a player can seek.
#[utoipa::path(
    get,
    path = "/api/audiobooks/{uuid}/parts/{ordinal}",
    tag = "Audiobooks",
    security(("bearer" = []), ("session_cookie" = []), ("media_token" = [])),
    params(
        ("uuid" = String, Path, description = "The book's uuid."),
        ("ordinal" = i64, Path, description = "The part's `ordinal` in the manifest."),
        PartsQuery,
    ),
    responses(
        (status = 200, description = "The whole part.", body = [u8], content_type = "audio/*"),
        (status = 206, description = "The byte range asked for in `Range`.", body = [u8], content_type = "audio/*"),
        (status = 304, description = "The part is unchanged since the `ETag` sent in `If-None-Match`, or the date in `If-Modified-Since`."),
        (status = 404, description = "No book with that uuid has an audio file, `file_id` isn't one of its audio files, the book plays through HLS, it has no part with that ordinal, or the part is missing from disk."),
        (status = 412, description = "`If-Match` or `If-Unmodified-Since` doesn't match the part."),
        (status = 416, description = "The `Range` lies outside the part. `Content-Range` gives its length."),
    ),
)]
pub(super) async fn get_audiobook_part(
    _user: MediaAuthUser,
    State(state): State<AppState>,
    Path((uuid, ordinal)): Path<(String, i64)>,
    Query(query): Query<PartsQuery>,
    req: Request,
) -> Response {
    // `MediaAuthUser`, not `AuthUser`: the mobile WebView's `<audio src>` can carry only
    // the `?token=` query param. Kept in lockstep with `is_media_read_path` in `auth::gate`.
    let resolved = match hls::resolve_audiobook_file(&state.pool, &uuid, query.file_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_audiobook", e),
    };
    let parts = match hls::get_parts(&state.pool, resolved.book_file_id).await {
        Ok(p) => p,
        Err(e) => return internal("get_parts", e),
    };
    // Mirror the manifest classifier: refuse to serve source files for
    // a book that `/manifest` would have routed through HLS. Keeps the
    // API contract honest — clients should never reach this endpoint
    // for an HLS-mode book.
    let filenames: Vec<&str> = parts.iter().map(|p| p.filename.as_str()).collect();
    if audiobook::classify_filenames(&filenames) != PlaybackMode::Direct {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    }
    let Some(part) = parts.into_iter().find(|p| p.ordinal == ordinal) else {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    };

    let abs_path = std::path::Path::new(&resolved.library_path).join(&part.filename);
    let mime = audiobook::mime_for_filename(&part.filename);
    // Served inline (no `Content-Disposition`) — this URL is wired straight
    // into an `<audio src>`. The validator comes from this part's own file,
    // not the `book_files` row: that row carries the group's `max(mtime)`
    // and summed size across every part, which is the wrong granularity for
    // a per-part URL.
    super::serve_file(req, &abs_path, mime, None).await
}

/// Download an audiobook file
///
/// One file of the audiobook as an attachment, named as it is on disk. A book made of
/// several parts downloads one part at a time: `part` picks which. Answers `Range`
/// requests, so an interrupted download can resume. Needs the download permission.
#[utoipa::path(
    get,
    path = "/api/audiobooks/{uuid}/download",
    tag = "Audiobooks",
    params(("uuid" = String, Path, description = "The book's uuid."), AudiobookDownloadQuery),
    responses(
        (status = 200, description = "The whole file.", body = [u8], content_type = "audio/*",
            headers(("Content-Disposition" = String, description = "`attachment`, with the file name."))),
        (status = 206, description = "The byte range asked for in `Range`.", body = [u8], content_type = "audio/*"),
        (status = 304, description = "The file is unchanged since the `ETag` sent in `If-None-Match`, or the date in `If-Modified-Since`."),
        (status = 403, description = "Your account lacks the download permission."),
        (status = 404, description = "No book with that uuid has an audio file, `file_id` isn't one of its audio files, it has no part with that ordinal, or the file is missing from disk."),
        (status = 412, description = "`If-Match` or `If-Unmodified-Since` doesn't match the file."),
        (status = 416, description = "The `Range` lies outside the file. `Content-Range` gives its length."),
    ),
)]
pub(super) async fn get_audiobook_download(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(query): Query<AudiobookDownloadQuery>,
    req: Request,
) -> Response {
    // Parts are served here, not via `/parts/{ordinal}`: that route is open to a
    // `can_download = 0` user, so offline downloads must not plan against it.
    if let Some(denied) = super::deny_without_download(&user) {
        return denied;
    }
    let resolved = match hls::resolve_audiobook_file(&state.pool, &uuid, query.file_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_audiobook_file", e),
    };
    let parts = match hls::get_parts(&state.pool, resolved.book_file_id).await {
        Ok(p) => p,
        Err(e) => return internal("get_parts", e),
    };
    let part = match query.part {
        Some(ordinal) => parts.into_iter().find(|p| p.ordinal == ordinal),
        None => parts.into_iter().min_by_key(|p| p.ordinal),
    };
    let Some(part) = part else {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    };
    let abs_path = std::path::Path::new(&resolved.library_path).join(&part.filename);
    let mime = audiobook::mime_for_filename(&part.filename);
    super::serve_download(req, &abs_path, mime).await
}

/// Get an audiobook's transcode status
///
/// How far the HLS transcode of an audiobook has got. Asking starts the transcode when it
/// hasn't started, so poll this while `state` is `preparing`. A failed transcode isn't
/// retried on its own.
#[utoipa::path(
    get,
    path = "/api/audiobooks/{uuid}/status",
    tag = "Audiobooks",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The transcode's status.", body = AudiobookStatus),
        (status = 404, description = "No book with that uuid has an audio file."),
    ),
)]
pub(super) async fn get_audiobook_status(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    let resolved = match hls::resolve_audiobook(&state.pool, &uuid).await {
        Ok(Some(r)) => r,
        Ok(None) => return axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_audiobook", e),
    };

    let book_id = resolved.book_id;
    let ready = hls::is_ready(book_id, hls::AUDIO64);
    let failed = hls::has_failed(book_id, hls::AUDIO64);
    let progress = hls::read_progress(book_id, hls::AUDIO64);

    // If neither ready nor in progress, kick off the transcode. The worker
    // serializes duplicate posts via the per-resource keyed mutex so a
    // second poll while the job is already running just enqueues behind
    // it. Skip the kick entirely when a `.failed` marker is present —
    // otherwise the frontend's 1 s status poll becomes an unbounded retry
    // loop on a permanently-broken book (corrupt source, missing ffmpeg).
    if !ready && progress < 0.05 && !failed {
        state.worker.post(Task::HlsTranscode {
            book_id,
            book_file_id: resolved.book_file_id,
            library_path: resolved.library_path,
            profile: hls::AUDIO64.to_string(),
        });
    }

    // `state` is what tells "preparing" from "permanently failed": the older
    // `ready: false, progress: 0` shape couldn't, so the UI stuck on "Preparing".
    let status_state = if ready {
        AudiobookStatusState::Ready
    } else if failed {
        AudiobookStatusState::Failed
    } else {
        AudiobookStatusState::Preparing
    };

    Json(AudiobookStatus {
        ready,
        progress,
        state: status_state,
    })
    .into_response()
}

/// Get an HLS segment
///
/// One MPEG-TS segment of a transcoded audiobook, named as the playlist lists it. When the
/// transcode hasn't made that segment yet, the request waits for the transcode to finish.
#[utoipa::path(
    get,
    path = "/api/audiobooks/{uuid}/segments/{segment}",
    tag = "Audiobooks",
    params(
        ("uuid" = String, Path, description = "The book's uuid."),
        ("segment" = String, Path, description = "The segment's file name, such as `seg-0001.ts`."),
    ),
    responses(
        (status = 200, description = "The whole segment.", body = [u8], content_type = "video/MP2T"),
        (status = 206, description = "The byte range asked for in `Range`.", body = [u8], content_type = "video/MP2T"),
        (status = 304, description = "The segment is unchanged since the `ETag` sent in `If-None-Match`, or the date in `If-Modified-Since`."),
        (status = 400, description = "`segment` isn't `seg-` and four digits and `.ts`."),
        (status = 404, description = "No book with that uuid has an audio file, or the transcode finished without that segment."),
        (status = 412, description = "`If-Match` or `If-Unmodified-Since` doesn't match the segment."),
        (status = 416, description = "The `Range` lies outside the segment. `Content-Range` gives its length."),
        (status = 503, description = "The book's transcode failed."),
    ),
)]
pub(super) async fn get_audiobook_segment(
    _user: AuthUser,
    State(state): State<AppState>,
    Path((uuid, segment)): Path<(String, String)>,
    req: Request,
) -> Response {
    // Validate: segment must match `seg-NNNN.ts` exactly.
    if !is_valid_segment_name(&segment) {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    }

    let resolved = match hls::resolve_audiobook(&state.pool, &uuid).await {
        Ok(Some(r)) => r,
        Ok(None) => return axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_audiobook", e),
    };

    let book_id = resolved.book_id;
    let seg_path = hls::segment_dir(book_id, hls::AUDIO64).join(&segment);

    // Fast path: segment already on disk.
    if !seg_path.exists() {
        // Permanent failure short-circuits the kick: a previous transcode
        // already cleaned the dir + wrote `.failed`, and any retry would
        // immediately bail with the same error. Return 503 so hls.js
        // surfaces a real failure to the user instead of stalling on a
        // never-arriving segment.
        if hls::has_failed(book_id, hls::AUDIO64) {
            return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        // Transcode hasn't produced this segment yet — trigger and wait.
        let task_id = state.worker.post(Task::HlsTranscode {
            book_id,
            book_file_id: resolved.book_file_id,
            library_path: resolved.library_path,
            profile: hls::AUDIO64.to_string(),
        });
        let _ = state.worker.await_completion(task_id).await;

        if !seg_path.exists() {
            return axum::http::StatusCode::NOT_FOUND.into_response();
        }
    }

    super::serve_file(req, &seg_path, MPEGTS_CONTENT_TYPE, None).await
}

/// `true` if `name` matches `seg-NNNN.ts` exactly (4 decimal digits).
/// Case-insensitive on prefix and extension, so it stays in sync with
/// case-insensitive filesystems (APFS, NTFS): `seg-0001.TS` must still resolve.
fn is_valid_segment_name(name: &str) -> bool {
    if name.len() != 11 {
        return false;
    }
    let bytes = name.as_bytes();
    // Byte-slice comparison avoids allocating a lowercased copy on the HLS hot path.
    bytes[..4].eq_ignore_ascii_case(b"seg-")
        && bytes[8..].eq_ignore_ascii_case(b".ts")
        && bytes[4..8].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests;
