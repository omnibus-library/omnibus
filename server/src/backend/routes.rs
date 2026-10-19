//! Route-group builder functions merged into the top-level `/api/*` router
//! by [`super::rest_router_with_search_limiter`]. Each function owns one
//! feature area; the grouping used to be carried as inline comments in a
//! single flat route list.

use std::{sync::Arc, time::Duration};

use axum::routing::{delete, get, patch, post, put};
use tower_http::timeout::RequestBodyTimeoutLayer;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::rate_limit::{rate_limit_by_ip, RateLimiter, RateLimits};

use super::{
    account, admin_health, admin_sessions, audiobooks, author_photos, authors, bookmarks, covers,
    cross_format, deletion, ebooks, genres, highlights, journals, kindle, merge, metadata,
    overrides, physical, profile, progress, ratings, read_status, scan, search, series, settings,
    shelves, stats, suggestions, summary, tags, uploads, users, AppState,
};

/// Health check, settings, ebooks, and audiobook playback routes.
pub(super) fn content_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(super::health::get_health))
        .routes(routes!(settings::get_settings, settings::post_settings))
        .routes(routes!(settings::post_registration))
        .routes(routes!(settings::get_mcp, settings::post_mcp))
        .routes(routes!(settings::post_reindex))
        .routes(routes!(settings::post_scan_library))
        .routes(routes!(settings::post_rebuild_fts))
        // Admin user, session and device management, all `AdminUser`-gated.
        .routes(routes!(users::get_users, users::post_user))
        .routes(routes!(users::delete_user))
        .routes(routes!(users::patch_permissions))
        .routes(routes!(users::post_password))
        .routes(routes!(users::post_unlock))
        .routes(routes!(admin_sessions::get_user_sessions))
        .routes(routes!(admin_sessions::get_user_devices))
        .routes(routes!(admin_sessions::delete_session))
        .routes(routes!(admin_sessions::delete_device))
        .routes(routes!(admin_health::get_admin_health))
        .routes(routes!(ebooks::get_library))
        .routes(routes!(ebooks::post_download_validators))
        .routes(routes!(ebooks::get_ebooks))
        .routes(routes!(ebooks::get_ebook_by_uuid))
        .routes(routes!(ebooks::chapters::get_ebook_chapters))
        .routes(routes!(ebooks::chapters::get_ebook_chapter_text))
        .routes(routes!(ebooks::images::get_ebook_images))
        .routes(routes!(ebooks::images::get_ebook_image_link))
        .routes(routes!(ebooks::images::get_ebook_image_file))
        .routes(routes!(ebooks::images::get_ebook_signed_image))
        .routes(routes!(ebooks::get_ebook_file))
        .routes(routes!(ebooks::get_ebook_page))
        .routes(routes!(ebooks::get_ebook_kepub))
        .routes(routes!(ebooks::get_ebook_download))
        .routes(routes!(audiobooks::get_audiobook_download))
        .routes(routes!(audiobooks::get_audiobook_manifest))
        .routes(routes!(audiobooks::get_audiobook_part))
        .routes(routes!(audiobooks::get_audiobook_playlist))
        .routes(routes!(audiobooks::get_audiobook_segment))
        .routes(routes!(audiobooks::get_audiobook_status))
        .routes(routes!(
            audiobooks::get_playback_rate,
            audiobooks::put_playback_rate
        ))
}

/// Metadata overrides, progress sync, author/cover/series/tag discovery routes, the
/// image-upload endpoints, and the search sub-router. The book uploads are not here:
/// [`book_upload_router`] is merged outside the request timeout. Each helper below owns
/// one feature area; this function just merges them.
pub(super) fn data_routes(
    search_limiter: Arc<RateLimiter>,
    limits: RateLimits,
) -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .merge(metadata_override_routes())
        .merge(progress_routes())
        .merge(merge_routes())
        .merge(deletion_routes())
        .merge(highlight_routes())
        .merge(bookmark_routes())
        .merge(engagement_routes())
        .merge(check_in_routes())
        .merge(physical_collection_routes())
        .merge(shelf_routes())
        .merge(journal_routes())
        .merge(upload_router(limits))
        .merge(search_router(search_limiter))
        .merge(discovery_routes())
        .merge(suggestion_routes())
        .merge(summary_routes())
        .merge(metadata_routes())
        .merge(kindle_routes())
}

/// Metadata override read/write + cover-only revert.
fn metadata_override_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(
            overrides::post_ebook_overrides,
            overrides::delete_ebook_overrides
        ))
        // Cover-only revert. Carries no upload body (unlike the POST in
        // `upload_router`), so it stays outside the upload rate limiter —
        // same split as the author-photo GET/DELETE (`discovery_routes`) vs
        // its PUT (`upload_router`).
        .routes(routes!(overrides::delete_ebook_cover))
        // Mirrors the /api/reindex-style admin triggers.
        .routes(routes!(overrides::post_rewrite_all_epubs))
}

/// Progress sync — mobile-facing REST. Web hits the analogous
/// `/api/rpc/progress*` server functions defined in `omnibus_frontend::rpc`.
fn progress_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(progress::post_progress))
        .routes(routes!(progress::post_sessions))
        .routes(routes!(progress::get_recent_progress))
        .routes(routes!(progress::get_progress))
        .routes(routes!(cross_format::get_cross_format_resume))
        .routes(routes!(cross_format::get_alignment))
        .routes(routes!(
            cross_format::post_cross_format_link,
            cross_format::delete_cross_format_link
        ))
        .routes(routes!(cross_format::post_sync_point))
        .routes(routes!(cross_format::post_cross_format_follow))
}

/// Admin book merge/unmerge — mobile-facing REST. Web hits the analogous
/// `/api/rpc/merge-books` and `/api/rpc/merge-books/undo` server fns in
/// `omnibus_frontend::rpc::books`, which repeat these handlers' `AdminUser` gate: the
/// merge transaction is shared, but the gate and error mapping are not, so change one
/// side's gate or response shape and the other needs the same edit.
fn merge_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(merge::post_merge_books))
        .routes(routes!(merge::post_undo_merge))
        .routes(routes!(merge::get_merge_candidates))
}

/// Admin book deletion — mobile-facing REST. Web hits the analogous
/// `/api/rpc/books/deletion-manifest` and `/api/rpc/books/delete-files`
/// server fns in `omnibus_frontend::rpc::books`; same gate-parity note as
/// [`merge_routes`].
fn deletion_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(deletion::get_deletion_manifest))
        .routes(routes!(deletion::post_delete_book_files))
}

/// Highlight annotations — mobile-facing REST. Web hits the analogous
/// `/api/rpc/highlights/*` server functions.
fn highlight_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(highlights::post_highlight))
        .routes(routes!(highlights::get_highlights))
        .routes(routes!(highlights::patch_highlight_color))
        .routes(routes!(highlights::patch_highlight_note))
        .routes(routes!(highlights::delete_highlight))
}

/// Bookmarks — mobile-facing REST. Web hits the analogous
/// `/api/rpc/bookmarks/*` server functions. One model serves both the
/// audiobook player and the reader (position = seconds or EPUB CFI).
fn bookmark_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(bookmarks::post_bookmark))
        .routes(routes!(bookmarks::get_bookmarks))
        .routes(routes!(bookmarks::put_bookmark, bookmarks::delete_bookmark))
}

/// Reading stats, star ratings, and read/unread state —
/// mobile-facing REST. Web hits the analogous `/api/rpc/stats`,
/// `/api/rpc/ratings/*`, and `/api/rpc/read-status/*` server functions.
fn engagement_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(stats::get_household_readers))
        .routes(routes!(stats::get_stats))
        .routes(routes!(stats::get_session_log))
        .routes(routes!(stats::put_stats_goal))
        .routes(routes!(stats::put_stats_daily_goal))
        .routes(routes!(stats::get_library_size))
        .routes(routes!(stats::get_library_composition))
        .routes(routes!(ratings::post_rating))
        .routes(routes!(ratings::get_other_ratings))
        .routes(routes!(ratings::get_rating, ratings::delete_rating))
        .routes(routes!(read_status::put_read_status))
        .routes(routes!(read_status::get_read_status))
}

/// Physical Check-In scan flow — mobile-facing REST. Web hits the analogous
/// `/api/rpc/scan/*` server functions.
fn check_in_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(scan::post_resolve))
        .routes(routes!(scan::post_search))
        .routes(routes!(scan::post_resolve_meta))
        .routes(routes!(scan::post_check_in))
        .routes(routes!(scan::post_add_physical_only))
        .routes(routes!(scan::post_wishlist_add))
        // Any user may read this flag; it drives the check-in scan screen's
        // provider note without the admin-only masked-status route.
        .routes(routes!(scan::get_google_books_configured))
        // Admin. Web hits the analogous `/api/rpc/google-books-key` server fn.
        .routes(routes!(
            scan::get_google_books_key,
            scan::post_google_books_key
        ))
}

/// F Physical Check-In — book-detail collection + wishlist reads/edits.
/// The literal `copies` routes are registered before `/{uuid}` so the
/// param route can't shadow them.
fn physical_collection_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(physical::patch_copy_note, physical::delete_copy))
        .routes(routes!(physical::get_copies))
        .routes(routes!(
            physical::get_wishlist_entry,
            physical::post_wishlist_entry,
            physical::delete_wishlist_entry
        ))
        .routes(routes!(physical::delete_book))
}

/// Shelves — mobile-facing REST. Web hits the analogous
/// `/api/rpc/shelves*` server functions. `/preview` and `/containing/{uuid}`
/// are registered before the `{id}` param route so it can't shadow them.
fn shelf_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(shelves::list_shelves, shelves::create_shelf))
        .routes(routes!(shelves::preview_rule))
        .routes(routes!(shelves::shelves_containing))
        .routes(routes!(shelves::smart_shelves_containing))
        .routes(routes!(
            shelves::get_shelf,
            shelves::update_shelf,
            shelves::delete_shelf
        ))
        .routes(routes!(shelves::get_shelf_page))
        .routes(routes!(shelves::add_shelf_books))
        .routes(routes!(shelves::remove_shelf_book))
}

/// Public journal entries — mobile-facing REST. Web hits the analogous
/// `/api/rpc/journals/*` server functions. Embedded-image reads are
/// media-gated like covers/thumbs; the matching upload POST lives in
/// `upload_router` (rate-limited, image body cap).
fn journal_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(journals::post_journal))
        .routes(routes!(journals::get_journal_entries))
        .routes(routes!(journals::post_journal_preview))
        .routes(routes!(journals::patch_journal, journals::delete_journal))
        .routes(routes!(journals::get_journal_image))
}

/// Cover/thumb/author/series/tag discovery routes, including author photo reads.
/// GET/DELETE for author photos carry no upload body (DELETE mutates, but cheaply), so
/// they stay outside the rate-limited `upload_router`; only the binary uploads (cover
/// POST, photo PUT, photo-url PUT) carry the per-IP frequency cap.
fn discovery_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(
            author_photos::get_author_photo,
            author_photos::delete_author_photo
        ))
        .routes(routes!(covers::get_cover))
        .routes(routes!(covers::get_thumb))
        .routes(routes!(authors::get_authors))
        .routes(routes!(authors::get_author_reading))
        .routes(routes!(author_photos::post_refetch_author_photos))
        .routes(routes!(author_photos::post_author_photo_scan))
        .routes(routes!(authors::get_author_by_id))
        .routes(routes!(series::get_series))
        .routes(routes!(series::get_series_by_id))
        .routes(routes!(tags::get_tags))
        .routes(routes!(genres::get_genres))
}

/// Suggestions — mobile-facing REST. Web hits the analogous
/// `/api/rpc/ebook-suggestions` + `/api/rpc/hardcover-key` server fns.
fn suggestion_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(suggestions::get_suggestions))
        .routes(routes!(suggestions::get_suggestion_cover))
        .routes(routes!(
            suggestions::get_hardcover_key,
            suggestions::post_hardcover_key
        ))
}

/// "Fetch Summary" — mobile-facing REST. Web hits the analogous
/// `/api/rpc/ebook/summary/*` server fns.
fn summary_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(summary::post_ebook_summary_fetch))
        .routes(routes!(summary::get_summary_sources))
}

/// The metadata-provider surface — mobile-facing REST. Web hits the analogous
/// `/api/rpc/metadata/*` server fns in `omnibus_frontend::rpc::metadata_search`, which
/// repeat these handlers' gates: the catalog is read-only for any authenticated user,
/// the edition search and hydrate are `can_edit`-gated inside their handlers. Change one
/// side's gate or response shape and the other needs the same edit.
fn metadata_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(metadata::get_providers))
        .routes(routes!(metadata::post_edition_search))
        .routes(routes!(metadata::post_edition_hydrate))
}

/// Send-to-Kindle plus the per-user account preferences that grew up
/// beside it (hidden formats, the book-detail scroll-stops switch, Stack
/// series, sharing stats with the household, the profile and its avatar) —
/// all mobile-facing REST. Web hits the analogous `/api/rpc/kindle/send`,
/// `/api/rpc/account/*`, and `/api/rpc/smtp*` server fns.
fn kindle_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(kindle::post_send))
        .routes(routes!(kindle::get_send_status))
        .routes(routes!(kindle::post_kindle_email))
        .routes(routes!(account::post_hidden_formats))
        .routes(routes!(account::post_book_detail_scroll_stops))
        .routes(routes!(account::post_stack_series))
        .routes(routes!(account::post_share_stats))
        .routes(routes!(profile::post_profile))
        // The avatar POST is in `upload_router`, under the upload rate limit.
        .routes(routes!(profile::delete_avatar))
        .routes(routes!(profile::get_user_avatar))
        .routes(routes!(kindle::get_smtp, kindle::post_smtp))
        .routes(routes!(kindle::post_smtp_clear))
        .routes(routes!(kindle::post_smtp_test))
}

/// Sub-router for `/api/search/*` carrying its own per-IP rate-limit layer, capping each
/// principal at `SEARCH_RATE_LIMIT_MAX` requests per `SEARCH_RATE_LIMIT_WINDOW` since each
/// handler runs heavy SQL. The `limiter` is passed in so the live server can share one
/// `Arc` across both search families; `rest_router` supplies a fresh dedicated one.
fn search_router(limiter: Arc<RateLimiter>) -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(search::get_search))
        .routes(routes!(search::get_search_content))
        .routes(routes!(search::get_search_palette))
        .layer(axum::middleware::from_fn_with_state(
            limiter,
            rate_limit_by_ip,
        ))
}

/// Per-IP rate-limited router for the binary-upload endpoints. Mirrors [`search_router`]:
/// a dedicated sub-router carrying its own `Arc<RateLimiter>`, merged into
/// [`super::rest_router`]. Its routes (cover `POST`, cover from-URL `POST`, journal image,
/// avatar, author-photo `PUT`s) each accept a multi-MiB payload or drive an outbound fetch,
/// so they share a per-IP budget. The `GET`/`DELETE` author-photo routes stay in `rest_router`.
fn upload_router(limits: RateLimits) -> OpenApiRouter<AppState> {
    let limiter = Arc::new(
        RateLimiter::with_policy(
            super::UPLOAD_RATE_LIMIT_WINDOW,
            super::UPLOAD_RATE_LIMIT_MAX,
        )
        .with_limits(limits),
    );
    OpenApiRouter::new()
        .routes(routes!(overrides::post_ebook_cover))
        // No upload body, but the only override route that spends an
        // *outbound* fetch — which is the cost this limiter is really for.
        .routes(routes!(overrides::post_ebook_cover_from_url))
        .routes(routes!(journals::post_journal_image))
        .routes(routes!(profile::post_avatar))
        .routes(routes!(author_photos::put_author_photo))
        .routes(routes!(author_photos::put_author_photo_url))
        // Image uploads need more than the global 1 MiB cap; layered closer
        // to the handler than the global limit in `main.rs`, so axum picks
        // this larger value for these routes (preserves the prior 11 MiB cap
        // that was on the cover/photo routes).
        .layer(axum::extract::DefaultBodyLimit::max(11 * 1024 * 1024))
        // Rate-limit layer added last so it is outermost: an over-budget
        // request is rejected before the body is buffered or the handler runs.
        .layer(axum::middleware::from_fn_with_state(
            limiter,
            rate_limit_by_ip,
        ))
}

/// Per-IP rate-limited router for the "add your own books" upload endpoints: same per-IP
/// policy as the image uploads (own bucket), kept separate from [`upload_router`] because
/// book/audiobook payloads are far larger, so they carry their own `DefaultBodyLimit` from
/// `OMNIBUS_MAX_UPLOAD_BYTES`. Merged outside [`super::REQUEST_TIMEOUT`]: `body_idle_timeout`
/// bounds a client that stops sending instead.
pub(super) fn book_upload_router(
    body_idle_timeout: Duration,
    limits: RateLimits,
) -> OpenApiRouter<AppState> {
    let limiter = Arc::new(
        RateLimiter::with_policy(
            super::UPLOAD_RATE_LIMIT_WINDOW,
            super::UPLOAD_RATE_LIMIT_MAX,
        )
        .with_limits(limits),
    );
    OpenApiRouter::new()
        .routes(routes!(uploads::post_inspect_ebook))
        .routes(routes!(uploads::post_upload_ebook))
        .routes(routes!(uploads::audiobooks::post_inspect_audiobook))
        .routes(routes!(uploads::audiobooks::post_upload_audiobook))
        // Book uploads need far more than the global 1 MiB cap; layered closer
        // to the handler so axum picks this larger value for these routes.
        .layer(axum::extract::DefaultBodyLimit::max(
            uploads::max_upload_bytes(),
        ))
        .layer(RequestBodyTimeoutLayer::new(body_idle_timeout))
        // Outermost: reject an over-budget request before buffering the body.
        .layer(axum::middleware::from_fn_with_state(
            limiter,
            rate_limit_by_ip,
        ))
}
