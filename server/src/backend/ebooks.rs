//! `/api/ebooks/*` handlers: session-gated reads that list the configured
//! library, look up a single book by uuid, and stream the raw EPUB bytes for
//! the in-app reader. Mounted on the mobile REST router in
//! [`super::rest_router`]. The `/file` stream additionally accepts a `?token=`
//! query param so epub.js can fetch the book from the mobile WebView.

use axum::{
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db, scanner,
    worker::{Task, TaskOutcome},
};
use omnibus_shared::{
    DownloadValidatorRequest, DownloadValidatorResponse, EbookFileQuery, EbookLibrary,
    EbookMetadata, EbookPage, EbooksQuery, FileBytes, LibraryContents, ViewFilters,
};

use super::conditional::{self, MEDIA_CACHE_CONTROL, MEDIA_VARY};

pub(super) mod chapters;
pub(super) mod images;
mod query;
use self::query::{decode_page_cursor, parse_formats, request_filters};
use super::{internal, with_pagination_headers, AppState};
use crate::auth::{AuthUser, MediaAuthUser};
use crate::http_errors::invalid_filter;

/// Default keyset page size for the paginated `GET /api/ebooks` form. A grid
/// renders ~30–60 cards above the fold and the table more; 100 covers both
/// without an oversized first paint. An explicit `?limit=` overrides it (the
/// db layer caps it at `MAX_BOOKS_RETURNED`).
const DEFAULT_PAGE_LIMIT: i64 = 100;

/// List books
///
/// The library's books, ebooks and audiobooks together. Without paging parameters the
/// response is the whole library, capped at 50,000 books: `X-Total-Count` holds the true
/// total, and `X-Total-Cap` appears when the cap cut the list short. Set `sort`, `dir`,
/// `limit` or `cursor` to page through it instead, following `X-Next-Cursor`.
#[utoipa::path(
    get,
    path = "/api/ebooks",
    tag = "Library",
    params(EbooksQuery),
    responses(
        (status = 200, description = "A page of books, or the whole library.", body = EbookPage, headers(
            ("X-Total-Count" = i64, description = "How many books match."),
            ("X-Next-Cursor" = String, description = "The `cursor` for the next page. Absent on the last page, and when the request wasn't paged."),
            ("X-Hidden-Count" = i64, description = "How many books `exclude_formats` left out. Sent on the first page only."),
            ("X-Total-Cap" = i64, description = "The cap, sent when it cut an unpaged response short."),
        )),
        (status = 400, description = "A `cursor` came without `sort` and `dir`, or a `cursor` or `filter` is malformed."),
    ),
)]
pub(super) async fn get_ebooks(
    user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<EbooksQuery>,
) -> Response {
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(error) => return internal("read settings", error),
    };
    let ebook = settings.ebook_library_path;
    let audiobook = settings.audiobook_library_path;

    // Backward-compatible default: with no pagination params the response is
    // byte-identical to the pre-F5b full (capped) library, so existing mobile
    // clients keep working untouched.
    if q.sort.is_none()
        && q.dir.is_none()
        && q.cursor.is_none()
        && q.limit.is_none()
        && q.formats.is_none()
        && q.filter.is_none()
        && q.exclude_formats.is_none()
    {
        return respond_full_library(&state, ebook.as_deref(), audiobook.as_deref()).await;
    }

    let viewer = db::Viewer {
        user_id: user.id,
        is_admin: user.is_admin,
    };
    respond_keyset_page(&state, &q, viewer, ebook.as_deref(), audiobook.as_deref()).await
}

/// Full (capped) combined library, with `X-Total-Count` / `X-Total-Cap`
/// headers — the unpaginated response shape for clients that send no cursor.
async fn respond_full_library(
    state: &AppState,
    ebook: Option<&str>,
    audiobook: Option<&str>,
) -> Response {
    match db::library_from_db_with_total_combined(&state.pool, ebook, audiobook).await {
        Ok((library, total)) => with_pagination_headers(Json(library).into_response(), total),
        Err(error) => internal("read books", error),
    }
}

/// The filtered total for the page's paths/filters/exclusion, plus — first
/// page only — the hidden-count receipt: the diff between that total and the
/// same query with the exclusion lifted. Later pages inherit the client's
/// cached value, so `hidden` stays `None` once `cursor` is set.
async fn page_totals(
    state: &AppState,
    paths: &[&str],
    filters: &ViewFilters,
    viewer: db::Viewer,
    exclude: &[String],
    cursor_is_none: bool,
) -> Result<(i64, Option<i64>), db::BooksError> {
    let total = db::count_books_page(&state.pool, paths, filters, viewer, exclude).await?;
    let hidden = if !exclude.is_empty() && cursor_is_none {
        let all = db::count_books_page(&state.pool, paths, filters, viewer, &[]).await?;
        Some(all - total)
    } else {
        None
    };
    Ok((total, hidden))
}

/// Assemble the `X-Total-Count` / `X-Hidden-Count` / `X-Next-Cursor` response
/// headers onto a JSON body. Unlike the full-library path, a keyset page is
/// *not* truncated to `MAX_BOOKS_RETURNED` overall (the limit is a per-page
/// clamp), so this emits the true `X-Total-Count` but never `X-Total-Cap` —
/// the page is complete.
fn keyset_page_response(
    body: EbookPage,
    total: i64,
    hidden: Option<i64>,
    next: Option<db::PageCursor>,
) -> Response {
    let mut resp = Json(body).into_response();
    if let Ok(v) = axum::http::HeaderValue::from_str(&total.to_string()) {
        resp.headers_mut().insert("X-Total-Count", v);
    }
    if let Some(h) = hidden {
        if let Ok(v) = axum::http::HeaderValue::from_str(&h.to_string()) {
            resp.headers_mut().insert("X-Hidden-Count", v);
        }
    }
    if let Some(next) = next {
        if let Ok(v) = axum::http::HeaderValue::from_str(&next.encode()) {
            resp.headers_mut().insert("X-Next-Cursor", v);
        }
    }
    resp
}

/// Keyset-paginated page for an explicit `sort`/`dir`/`cursor`/`limit`. A
/// cursor is decoded relative to the request's sort axis, so a cursor without
/// an explicit `sort` **and** `dir`, or a malformed cursor, is a 400 rather
/// than a silently mis-positioned page or a 500.
async fn respond_keyset_page(
    state: &AppState,
    q: &EbooksQuery,
    viewer: db::Viewer,
    ebook: Option<&str>,
    audiobook: Option<&str>,
) -> Response {
    let cursor = match decode_page_cursor(q) {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };
    let filters = match request_filters(q) {
        Ok(f) => f,
        Err(reason) => return invalid_filter(&reason),
    };
    let path = ebook.or(audiobook).map(str::to_string);
    let paths = db::collect_paths(ebook, audiobook);
    let exclude = omnibus_shared::sanitize_exclude_formats(
        q.exclude_formats
            .as_deref()
            .map(parse_formats)
            .unwrap_or_default(),
    );
    let page = match keyset_rows(
        state,
        q,
        &paths,
        &filters,
        &exclude,
        cursor.as_ref(),
        viewer,
    )
    .await
    {
        Ok(p) => p,
        Err(error) => return internal("read books page", error),
    };
    // Filtered total, so the client's "Show N books" reflects the active
    // chips (and the exclusion — it counts what pagination will actually
    // yield); identical to the unfiltered count when neither is set.
    let (total, hidden) =
        match page_totals(state, &paths, &filters, viewer, &exclude, cursor.is_none()).await {
            Ok(t) => t,
            Err(error) => return internal("count books", error),
        };

    let body = EbookPage {
        library: EbookLibrary {
            path,
            books: page.books,
            error: None,
            total: None,
        },
        stacks: page.stacks,
    };
    keyset_page_response(body, total, hidden, page.next)
}

/// The page's rows: series-stacked when the request asks for it, else plain with no stacks.
async fn keyset_rows(
    state: &AppState,
    q: &EbooksQuery,
    paths: &[&str],
    filters: &ViewFilters,
    exclude: &[String],
    cursor: Option<&db::PageCursor>,
    viewer: db::Viewer,
) -> Result<db::StackedBookPage, db::BooksError> {
    let sort = q.sort.unwrap_or_default();
    let dir = q.dir.unwrap_or_default();
    let limit = q.limit.unwrap_or(DEFAULT_PAGE_LIMIT);
    let projection = if q.omit_description.unwrap_or(false) {
        db::books::Projection::List
    } else {
        db::books::Projection::Full
    };
    if q.stack_series.unwrap_or(false) {
        db::list_books_page_stacked(
            &state.pool,
            paths,
            sort,
            dir,
            filters,
            viewer,
            exclude,
            cursor,
            limit,
            projection,
        )
        .await
    } else {
        let page = db::books::list_books_page_projected(
            &state.pool,
            paths,
            sort,
            dir,
            filters,
            viewer,
            exclude,
            cursor,
            limit,
            projection,
        )
        .await?;
        Ok(db::StackedBookPage {
            books: page.books,
            next: page.next,
            stacks: Vec::new(),
        })
    }
}

/// Get a book
///
/// One book's full record.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}",
    tag = "Library",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book.", body = EbookMetadata),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_ebook_by_uuid(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::get_book_by_uuid(&state.pool, &uuid).await {
        Ok(Some(book)) => Json(book).into_response(),
        Ok(None) => axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal("read book", error),
    }
}

/// Wire mime for a served PDF.
pub(crate) const PDF_MIME: &str = "application/pdf";
/// Wire mime for a served EPUB (and KEPUB).
pub(crate) const EPUB_MIME: &str = "application/epub+zip";

/// A resolved text-bearing file: its path, the book it belongs to, its
/// uppercase `book_files.format`, and the mime the wire carries it under.
struct TextFile {
    path: std::path::PathBuf,
    book_id: i64,
    format: &'static str,
    mime: &'static str,
}

/// Resolve the text-bearing file `/download` (and `?file_id=` on `/file`) serves:
/// with a `file_id`, that row when it is an EPUB or a PDF (never a CBZ); without one,
/// the EPUB else the PDF (`db::book_text_source`'s order). `Err` carries the book id
/// when the uuid resolved, so a caller can fall through to the comic archive.
async fn resolve_text_path(
    state: &AppState,
    uuid: &str,
    file_id: Option<i64>,
) -> Result<TextFile, (Response, Option<i64>)> {
    let id = match db::resolve_book_id_by_uuid(&state.pool, uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return Err((axum::http::StatusCode::NOT_FOUND.into_response(), None)),
        Err(e) => return Err((internal("resolve_book_id_by_uuid", e), None)),
    };
    let Some(file_id) = file_id else {
        return match db::book_text_source(&state.pool, id).await {
            Ok(Some(source)) => {
                let (format, mime) = if source.format == "PDF" {
                    ("PDF", PDF_MIME)
                } else {
                    ("EPUB", EPUB_MIME)
                };
                Ok(TextFile {
                    path: source.path,
                    book_id: id,
                    format,
                    mime,
                })
            }
            Ok(None) => Err((axum::http::StatusCode::NOT_FOUND.into_response(), Some(id))),
            Err(e) => Err((internal("book_text_source", e), Some(id))),
        };
    };
    for (format, mime) in [("EPUB", EPUB_MIME), ("PDF", PDF_MIME)] {
        match db::book_file_path_by_id(&state.pool, id, file_id, Some(format)).await {
            Ok(Some(path)) => {
                return Ok(TextFile {
                    path,
                    book_id: id,
                    format,
                    mime,
                })
            }
            Ok(None) => continue,
            Err(e) => return Err((internal("book_file_path_by_id", e), Some(id))),
        }
    }
    Err((axum::http::StatusCode::NOT_FOUND.into_response(), Some(id)))
}

/// Wire mime for a served CBZ archive. The registered comic-book zip type,
/// which downloaders and shelf apps recognize where a bare
/// `application/zip` would not say what the bytes are.
pub(crate) const CBZ_MIME: &str = "application/vnd.comicbook+zip";

/// Resolve the file `/file` streams for `uuid` on the one precedence ladder every
/// surface shares: the EPUB when the book has one, else its CBZ archive, else its PDF.
/// The archive fallback lets a comic-only book be taken offline whole. An explicit
/// `?file_id=` names an EPUB or PDF row only; it never resolves to an archive.
async fn resolve_readable_path(
    state: &AppState,
    uuid: &str,
    file_id: Option<i64>,
) -> Result<(std::path::PathBuf, &'static str), Response> {
    if file_id.is_some() {
        return match resolve_text_path(state, uuid, file_id).await {
            Ok(file) => Ok((file.path, file.mime)),
            Err((resp, _)) => Err(resp),
        };
    }
    let id = match db::resolve_book_id_by_uuid(&state.pool, uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return Err(StatusCode::NOT_FOUND.into_response()),
        Err(e) => return Err(internal("resolve_book_id_by_uuid", e)),
    };
    match device_file(state, id).await {
        Ok(Some(DeviceFile::Epub(path))) => Ok((path, EPUB_MIME)),
        Ok(Some(DeviceFile::Other(path, mime))) => Ok((path, mime)),
        Ok(None) => Err(StatusCode::NOT_FOUND.into_response()),
        Err(e) => Err(internal("device_file", e)),
    }
}

/// The file a device download serves for one book: its EPUB (the caller picks the bytes, so
/// it can convert or rewrite) or a CBZ/PDF to stream as-is with its mime.
pub(super) enum DeviceFile {
    Epub(std::path::PathBuf),
    Other(std::path::PathBuf, &'static str),
}

/// Resolve a book's [`DeviceFile`] on the shared ladder: EPUB, else CBZ, else PDF.
/// CBZ outranks PDF: a book carrying both is a comic scanned twice, and the comic
/// pipeline is the one that is offline-verified. `None` when the book has none of them.
pub(super) async fn device_file(
    state: &AppState,
    book_id: i64,
) -> anyhow::Result<Option<DeviceFile>> {
    if let Some(epub) = db::book_file_path(&state.pool, book_id, "EPUB").await? {
        return Ok(Some(DeviceFile::Epub(epub)));
    }
    for (format, mime) in [("CBZ", CBZ_MIME), ("PDF", PDF_MIME)] {
        if let Some(path) = db::book_file_path(&state.pool, book_id, format).await? {
            return Ok(Some(DeviceFile::Other(path, mime)));
        }
    }
    Ok(None)
}

/// Get a book's file
///
/// The book's EPUB, else its CBZ archive for a comic, else its PDF, served inline for
/// reading or for taking the book offline. `file_id` picks one of its EPUB or PDF files
/// instead. Answers `Range` requests. Every response, errors included, carries
/// `Access-Control-Allow-Origin: *`. For a copy with your metadata edits baked in, use
/// `GET /api/ebooks/{uuid}/download`.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/file",
    tag = "Library",
    security(("bearer" = []), ("session_cookie" = []), ("media_token" = [])),
    params(("uuid" = String, Path, description = "The book's uuid."), EbookFileQuery),
    responses(
        (status = 200, description = "The whole file.", content(
            (FileBytes = "application/epub+zip"),
            (FileBytes = "application/vnd.comicbook+zip"),
            (FileBytes = "application/pdf"),
        )),
        (status = 206, description = "The byte range asked for in `Range`.", content(
            (FileBytes = "application/epub+zip"),
            (FileBytes = "application/vnd.comicbook+zip"),
            (FileBytes = "application/pdf"),
        )),
        (status = 304, description = "The file is unchanged since the `ETag` sent in `If-None-Match`, or the date in `If-Modified-Since`."),
        (status = 404, description = "No book has that uuid, the book has no EPUB, CBZ or PDF, `file_id` isn't one of its EPUB or PDF files, or the file is missing from disk."),
        (status = 412, description = "`If-Match` or `If-Unmodified-Since` doesn't match the file."),
        (status = 416, description = "The `Range` lies outside the file. `Content-Range` gives its length."),
    ),
)]
pub(super) async fn get_ebook_file(
    _user: MediaAuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(query): Query<EbookFileQuery>,
    req: Request,
) -> Response {
    // `MediaAuthUser`, not `AuthUser`: epub.js fetches this from the mobile WebView,
    // which can carry only a `?token=` query param.
    let mut resp = read_ebook_file(&state, &uuid, query.file_id, req).await;
    // epub.js reads this stream over a cross-origin XHR from inside the mobile
    // WebView (unlike the CORS-exempt `<img>`/`<audio>` media the app uses
    // elsewhere), so the ACAO must ride *every* response — including the 404 /
    // 500 error paths — or the WebView can't read the outcome. The URL query
    // token is the only credential, so a wildcard never widens real access.
    resp.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    resp
}

/// Resolve the book's readable file (EPUB, else CBZ, else PDF) and stream its bytes,
/// or report the resolution failure as a 404 / 500; the caller adds CORS. Supports
/// `Range`, with no `Content-Disposition`: `/download` is the save-to-disk route.
async fn read_ebook_file(
    state: &AppState,
    uuid: &str,
    file_id: Option<i64>,
    req: Request,
) -> Response {
    let (path, mime) = match resolve_readable_path(state, uuid, file_id).await {
        Ok(resolved) => resolved,
        Err(resp) => return resp,
    };
    super::serve_file(req, &path, mime, None).await
}

/// Get a comic page
///
/// One page image from the book's CBZ archive, so you never download or unzip the whole
/// archive. Pages are numbered from 0 in the archive's natural sort order, the order the
/// book's `page_count` counts.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/pages/{page}",
    tag = "Library",
    security(("bearer" = []), ("session_cookie" = []), ("media_token" = [])),
    params(
        ("uuid" = String, Path, description = "The book's uuid."),
        ("page" = usize, Path, description = "The page number, from 0."),
    ),
    responses(
        (status = 200, description = "The page image.", body = FileBytes, content_type = "image/*"),
        (status = 304, description = "The page is unchanged since the `ETag` sent in `If-None-Match`."),
        (status = 404, description = "No book has that uuid, the book has no CBZ, or it has no page with that number."),
    ),
)]
pub(super) async fn get_ebook_page(
    _user: MediaAuthUser,
    State(state): State<AppState>,
    Path((uuid, page)): Path<(String, usize)>,
    headers: HeaderMap,
) -> Response {
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    let path = match db::book_file_path(&state.pool, id, "CBZ").await {
        Ok(Some(p)) => p,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("book_file_path", e),
    };

    // Validator from the CBZ's own stat plus the page index, not a hash of the
    // decompressed page; listing and decompression reuse this one handle, so a racing
    // replace can't splice one file's validator onto another's bytes.
    let open = match conditional::open(&path).await {
        Ok(o) => o,
        Err(e) => return internal("open cbz for page validator", e),
    };
    let etag = format!("\"{}-p{page}\"", open.validator.etag.trim_matches('"'));
    let file = open.into_std().await;

    let listed = tokio::task::spawn_blocking(move || db::comic::list_pages_from_file(file)).await;
    let (file, pages) = match listed {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => return internal("list comic pages", e),
        Err(e) => return internal("list comic pages", e),
    };
    let Some(name) = pages.get(page).cloned() else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| conditional::if_none_match_hits(v, &etag))
    {
        return conditional::not_modified(&etag, MEDIA_CACHE_CONTROL, MEDIA_VARY);
    }

    let read =
        tokio::task::spawn_blocking(move || db::comic::read_page_from_file(file, &name)).await;
    let (mime, bytes) = match read {
        Ok(Ok(entry)) => entry,
        Ok(Err(e)) => return internal("read comic page", e),
        Err(e) => return internal("read comic page", e),
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, MEDIA_CACHE_CONTROL),
            (header::ETAG, etag.as_str()),
            (header::VARY, MEDIA_VARY),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}

/// Wall-clock budget for an inline KEPUB conversion before we give up and
/// serve plain EPUB. Kept under the global 30 s request timeout so a slow
/// book downloads *something* rather than 408-ing; the worker keeps running
/// and warms the cache for next time.
const KEPUB_CONVERT_BUDGET: std::time::Duration = std::time::Duration::from_secs(25);

/// Download a book as a KEPUB
///
/// The book's EPUB converted to Kobo's KEPUB format, as an attachment named
/// `{uuid}.kepub.epub`, for copying onto a Kobo over USB. The first request converts the
/// book, which can take up to 25 seconds. When the conversion fails or runs longer, you get
/// the plain EPUB, named `{uuid}.epub`, instead. Either file carries your metadata and cover
/// edits. Needs the download permission.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/kepub",
    tag = "Library",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The KEPUB, or the plain EPUB.", body = FileBytes, content_type = "application/epub+zip",
            headers(("Content-Disposition" = String, description = "`attachment`, with the file name."))),
        (status = 403, description = "Your account lacks the download permission."),
        (status = 404, description = "No book has that uuid, or the book has no EPUB or its EPUB is missing from disk."),
    ),
)]
pub(super) async fn get_ebook_kepub(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    if let Some(denied) = super::deny_without_download(&user) {
        return denied;
    }
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    // Canonical uuid (merged-uuid aware) is the stable filename stem, so a USB
    // annotation import can map the device's `ContentID` back to the book.
    let canonical = match db::resolve_canonical_book_uuid(&state.pool, &uuid).await {
        Ok(Some(u)) => u,
        Ok(None) => uuid.clone(),
        Err(e) => return internal("resolve_canonical_book_uuid", e),
    };

    if kepub_conversion_succeeded(&state, id).await {
        let path = db::kepub_path(id);
        match tokio::fs::read(&path).await {
            Ok(bytes) => return download_response(bytes, &format!("{canonical}.kepub.epub")),
            Err(e) => {
                tracing::warn!(book_id = id, ?path, error = %e, "kepub cache read failed; serving plain epub");
            }
        }
    }

    // Fallback: the plain EPUB — still override-baked so a Kobo without
    // kepubify support (or after a conversion failure) shows the user's edits.
    let source = match db::book_file_path(&state.pool, id, "EPUB").await {
        Ok(Some(p)) => p,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("book_file_path", e),
    };
    let path = rewritten_or_source(&state, id, source).await;
    match tokio::fs::read(&path).await {
        Ok(bytes) => download_response(bytes, &format!("{canonical}.epub")),
        Err(e) => {
            tracing::warn!(book_id = id, ?path, error = %e, "epub file read failed");
            StatusCode::NOT_FOUND.into_response()
        }
    }
}

/// Enqueue the (idempotent, cache-backed) KEPUB conversion and wait up to
/// [`KEPUB_CONVERT_BUDGET`]. `true` when the cache is ready to serve.
async fn kepub_conversion_succeeded(state: &AppState, book_id: i64) -> bool {
    let task_id = state.worker.post(Task::KepubConvert { book_id });
    match tokio::time::timeout(KEPUB_CONVERT_BUDGET, state.worker.await_completion(task_id)).await {
        Ok(TaskOutcome::Ok(_)) => true,
        Ok(TaskOutcome::Err(msg)) => {
            tracing::warn!(book_id, error = %msg, "kepub conversion failed; serving plain epub");
            false
        }
        Err(_elapsed) => {
            tracing::warn!(
                book_id,
                "kepub conversion exceeded budget; serving plain epub"
            );
            false
        }
    }
}

/// Build an `attachment` download response for EPUB/KEPUB bytes with the given
/// filename. Both formats are `application/epub+zip`; the `.kepub.epub`
/// extension is what tells a Kobo to render it as a KEPUB.
fn download_response(bytes: Vec<u8>, filename: &str) -> Response {
    let disposition = format!("attachment; filename=\"{filename}\"");
    let mut resp = bytes.into_response();
    let h = resp.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/epub+zip"),
    );
    h.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=0"),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    resp
}

/// Download a book
///
/// The book's EPUB, or its PDF when it has no EPUB, as an attachment. `file_id` picks one of
/// its EPUB or PDF files instead. An EPUB carries your metadata and cover edits. A comic's
/// archive comes from `GET /api/ebooks/{uuid}/file`. Answers `Range` requests, so an
/// interrupted download can resume. Needs the download permission.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/download",
    tag = "Library",
    params(("uuid" = String, Path, description = "The book's uuid."), EbookFileQuery),
    responses(
        (status = 200, description = "The whole file.", content(
            (FileBytes = "application/epub+zip"),
            (FileBytes = "application/pdf"),
        ), headers(("Content-Disposition" = String, description = "`attachment`, with the file name."))),
        (status = 206, description = "The byte range asked for in `Range`.", content(
            (FileBytes = "application/epub+zip"),
            (FileBytes = "application/pdf"),
        )),
        (status = 304, description = "The file is unchanged since the `ETag` sent in `If-None-Match`, or the date in `If-Modified-Since`."),
        (status = 403, description = "Your account lacks the download permission."),
        (status = 404, description = "No book has that uuid, the book has no EPUB or PDF, `file_id` isn't one of its EPUB or PDF files, or the file is missing from disk."),
        (status = 412, description = "`If-Match` or `If-Unmodified-Since` doesn't match the file."),
        (status = 416, description = "The `Range` lies outside the file. `Content-Range` gives its length."),
    ),
)]
pub(super) async fn get_ebook_download(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(query): Query<EbookFileQuery>,
    req: Request,
) -> Response {
    if let Some(denied) = super::deny_without_download(&user) {
        return denied;
    }
    let file = match resolve_text_path(&state, &uuid, query.file_id).await {
        Ok(file) => file,
        Err((resp, _)) => return resp,
    };
    // A saved download must carry the user's metadata/cover edits (F5.8 #1372),
    // so serve the override-baked EPUB when the book has any; otherwise the
    // source verbatim. The bake is an OPF rewrite, so a PDF is always the
    // source as scanned.
    let path = if file.format == "EPUB" {
        rewritten_or_source(&state, file.book_id, file.path).await
    } else {
        file.path
    };
    // The validator is taken from whichever file is actually sent. For an
    // override-having book that is the export-cache copy, whose own stat
    // moves when `books.last_modified` invalidates it — so it tracks the
    // bytes on the wire rather than the source they came from.
    super::serve_download(req, &path, file.mime).await
}

/// The override-baked export EPUB for `book_id` when the book has edits, else
/// `source` unchanged. A rewrite failure logs and falls back to `source` — an
/// export must always download *something*. `pub(super)` so the Kobo plain-
/// EPUB download fallback (`backend::kobo::download`) shares it rather than
/// serving the raw on-disk file when overrides exist.
pub(super) async fn rewritten_or_source(
    state: &AppState,
    book_id: i64,
    source: std::path::PathBuf,
) -> std::path::PathBuf {
    match db::rewritten_epub_path(&state.pool, book_id, &source).await {
        Ok(Some(rewritten)) => rewritten,
        Ok(None) => source,
        Err(e) => {
            tracing::warn!(book_id, error = %e, "epub override-rewrite failed; serving source");
            source
        }
    }
}

/// Count the files in the library folders
///
/// How many ebook and audiobook files the configured library folders hold, by extension.
/// It walks the folders on disk, so it counts files a scan hasn't indexed yet. A folder that
/// is missing or unreadable reports `error` in its section instead of failing the request.
#[utoipa::path(
    get,
    path = "/api/library",
    tag = "Library",
    responses((status = 200, description = "The file counts.", body = LibraryContents)),
)]
pub(super) async fn get_library(_user: AuthUser, State(state): State<AppState>) -> Response {
    match db::get_settings(&state.pool).await {
        Ok(settings) => {
            let contents = scanner::scan_libraries(
                settings.ebook_library_path.as_deref(),
                settings.audiobook_library_path.as_deref(),
            );
            Json(contents).into_response()
        }
        Err(error) => internal("read settings", error),
    }
}

#[cfg(test)]
mod tests;

/// Check downloaded files for changes
///
/// The current `etag` of each file you name, so a device can learn in one request which of
/// its downloaded books changed: compare each with the `etag` saved at download time. A file
/// that is gone, or that the scanner hasn't measured yet, comes back without an `etag`. Read
/// that as "can't tell", never as "unchanged".
#[utoipa::path(
    post,
    path = "/api/downloads/validators",
    tag = "Library",
    request_body = DownloadValidatorRequest,
    responses(
        (status = 200, description = "One answer per file asked about.", body = DownloadValidatorResponse),
        (status = 422, description = "The request names more than 500 files."),
    ),
)]
pub(super) async fn post_download_validators(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(request): Json<DownloadValidatorRequest>,
) -> Response {
    if request.files.len() > omnibus_shared::MAX_VALIDATOR_QUERY {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            "too many files in one validator request",
        )
            .into_response();
    }
    match db::download_validators(&state.pool, &request.files).await {
        Ok(files) => Json(DownloadValidatorResponse { files }).into_response(),
        Err(error) => internal("download validators", error),
    }
}
