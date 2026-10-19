//! Physical Check-In scan REST handlers for the mobile client (`/api/scan/*`):
//! resolve a scanned or typed ISBN down the matching ladder, then check in a
//! physical copy, add a physical-only book, or wishlist one. Any authenticated
//! user may act — physical ownership is library-wide. Web clients use the
//! analogous `/api/rpc/scan/*` server functions.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, MetadataLookupError, PhysicalError, ScanError};
use omnibus_shared::{
    AddPhysicalOnlyRequest, BookRef, CheckInRequest, GoogleBooksKeyStatus, ResolveMetaRequest,
    ResolveRequest, ScanOutcome, ScanSearchRequest, ScanSearchResponse, SetGoogleBooksKey,
    WishlistAddRequest,
};

use super::{internal, AppState};
use crate::auth::{AdminUser, AuthUser};

/// The provider ladder's config for this instance: saved settings keys win
/// over the `GOOGLE_BOOKS_API_KEY` / `HARDCOVER_API_KEY` env vars, and a
/// provider with no key is simply one the ladder skips.
async fn provider_config(state: &AppState) -> Result<db::MetadataLookupConfig, db::SettingsError> {
    Ok(db::MetadataLookupConfig::live(
        db::provider_keys(&state.pool).await?,
    ))
}

/// Map a scan-flow error to a response: user-actionable cases become 400/404,
/// an unreachable metadata provider becomes 503, DB failures become 500.
fn scan_error(context: &'static str, e: ScanError) -> Response {
    match e {
        ScanError::Isbn(inner) => (StatusCode::BAD_REQUEST, inner.to_string()).into_response(),
        ScanError::MissingWishlistTarget => {
            (StatusCode::BAD_REQUEST, e.to_string()).into_response()
        }
        ScanError::Physical(PhysicalError::BookNotFound) => {
            (StatusCode::NOT_FOUND, "book not found").into_response()
        }
        // Both providers being down is an outage, not a bug in Omnibus: 503
        // with the cause logged, so the flow says "try again later" instead of
        // "internal server error".
        ScanError::Lookup(inner @ MetadataLookupError::Provider(_)) => {
            tracing::warn!(context, error = ?inner, "metadata provider unavailable");
            (StatusCode::SERVICE_UNAVAILABLE, inner.to_string()).into_response()
        }
        other => internal(context, other),
    }
}

/// Resolve an ISBN
///
/// Looks a scanned or typed ISBN up in the library, then at the metadata providers, and
/// says what to offer next: `already_owned`, `on_wishlist` (yours), `in_library_unowned`,
/// `close_match` (a library book with the same title and author, to confirm before
/// writing anything), `not_in_library` or `unresolved`. Takes an ISBN-10 or ISBN-13, with
/// or without hyphens.
#[utoipa::path(
    post,
    path = "/api/scan/resolve",
    tag = "Physical books",
    operation_id = "resolve_isbn",
    request_body = ResolveRequest,
    responses(
        (status = 200, description = "What the ISBN matched.", body = ScanOutcome),
        (status = 400, description = "The ISBN is empty, longer than 32 characters, or not a valid ISBN."),
        (status = 503, description = "No metadata provider could be reached."),
    ),
)]
pub(super) async fn post_resolve(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<ResolveRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let config = match provider_config(&state).await {
        Ok(c) => c,
        Err(e) => return internal("scan_resolve_provider_keys", e),
    };
    match db::resolve_scan(&state.pool, user.id, &req.isbn, &config).await {
        Ok(outcome) => Json(outcome).into_response(),
        Err(e) => scan_error("scan_resolve", e),
    }
}

/// Search the providers by title
///
/// Searches the metadata providers by free text, for when an ISBN resolves to
/// `unresolved`. Pass the result the reader picks to `POST /api/scan/resolve-meta`. An
/// empty list means the providers answered and none matched.
#[utoipa::path(
    post,
    path = "/api/scan/search",
    tag = "Physical books",
    operation_id = "search_providers_by_title",
    request_body = ScanSearchRequest,
    responses(
        (status = 200, description = "The candidates the providers returned.", body = ScanSearchResponse),
        (status = 400, description = "The query is blank or longer than 200 characters."),
        (status = 503, description = "No metadata provider could be reached."),
    ),
)]
pub(super) async fn post_search(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<ScanSearchRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let config = match provider_config(&state).await {
        Ok(c) => c,
        Err(e) => return internal("scan_search_provider_keys", e),
    };
    match db::search_provider_by_title(&config, req.query.trim()).await {
        Ok(results) => Json(ScanSearchResponse { results }).into_response(),
        Err(e) => scan_error("scan_search", e.into()),
    }
}

/// Resolve a title-search result
///
/// Matches a result from `POST /api/scan/search` against the library, as
/// `POST /api/scan/resolve` does for an ISBN, without asking the providers again. The
/// outcome is never `unresolved`.
#[utoipa::path(
    post,
    path = "/api/scan/resolve-meta",
    tag = "Physical books",
    operation_id = "resolve_search_result",
    request_body = ResolveMetaRequest,
    responses(
        (status = 200, description = "What the result matched.", body = ScanOutcome),
        (status = 400, description = "A field of `meta` is too long; the body says which."),
    ),
)]
pub(super) async fn post_resolve_meta(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<ResolveMetaRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let config = match provider_config(&state).await {
        Ok(c) => c,
        Err(e) => return internal("scan_resolve_meta_provider_keys", e),
    };
    match db::resolve_meta(&state.pool, user.id, &req.meta, &config).await {
        Ok(outcome) => Json(outcome).into_response(),
        Err(e) => scan_error("scan_resolve_meta", e),
    }
}

/// Check whether a Google Books key is set
///
/// `true` when the server has a Google Books API key, saved in settings or set in its
/// environment. Without one, Google Books lookups share an anonymous quota that runs out
/// quickly, so a client can warn that ISBN lookups may fail.
#[utoipa::path(
    get,
    path = "/api/scan/google-books-configured",
    tag = "Physical books",
    responses((status = 200, description = "Whether a key is set.", body = bool)),
)]
pub(super) async fn get_google_books_configured(
    _user: AuthUser,
    State(state): State<AppState>,
) -> Response {
    // Any user may read this flag; `GET /api/google-books-key` adds the masked key
    // and is admin-only.
    match db::google_books_key_status(&state.pool).await {
        Ok(status) => Json(status.configured).into_response(),
        Err(e) => internal("google books key status", e),
    }
}

/// Get the Google Books key's status
///
/// Whether a Google Books API key is set, where it comes from, and a masked preview. The
/// key itself is never returned. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/google-books-key",
    tag = "Admin",
    responses(
        (status = 200, description = "The key's status.", body = GoogleBooksKeyStatus),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_google_books_key(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> Response {
    // Mirrors the Hardcover key handlers in `suggestions.rs`; the shared logic lives
    // once in db's `SecretKeySpec`.
    match db::google_books_key_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read google books key", e),
    }
}

/// Set the Google Books key
///
/// Saves the server-wide Google Books API key, or clears it when `key` is `null`, absent
/// or blank. With a key, ISBN lookups ask Google Books first; without one, Open Library.
/// Clearing the saved key falls back to the server's `GOOGLE_BOOKS_API_KEY` environment
/// variable, when that is set. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/google-books-key",
    tag = "Admin",
    request_body = SetGoogleBooksKey,
    responses(
        (status = 200, description = "The key's new status.", body = GoogleBooksKeyStatus),
        (status = 403, description = "You aren't an admin."),
        (status = 422, description = "The key is longer than 512 bytes."),
    ),
)]
pub(super) async fn post_google_books_key(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(body): Json<SetGoogleBooksKey>,
) -> Response {
    match db::set_google_books_api_key(&state.pool, body.key.as_deref()).await {
        Ok(()) => {}
        Err(db::SettingsError::Validation(msg)) => {
            return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
        }
        Err(e) => return internal("save google books key", e),
    }
    match db::google_books_key_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read google books key", e),
    }
}

/// Check in a physical copy
///
/// Records a physical copy of a book the library already has, filed under you, and takes
/// the book off every reader's wishlist. `isbn` is stored as an ISBN-13, or dropped when
/// it isn't a valid ISBN. The answer carries the book's current uuid, which differs from
/// `book_uuid` when that book has been merged into another.
#[utoipa::path(
    post,
    path = "/api/scan/check-in",
    tag = "Physical books",
    operation_id = "check_in_copy",
    request_body = CheckInRequest,
    responses(
        (status = 200, description = "The copy is checked in.", body = BookRef),
        (status = 400, description = "`book_uuid` is empty or longer than 64 bytes, `isbn` is longer than 32 characters, or `note` is longer than 4096 characters."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn post_check_in(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CheckInRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::check_in_copy(
        &state.pool,
        &req.book_uuid,
        req.isbn.as_deref(),
        Some(user.id),
        req.note.as_deref(),
    )
    .await
    {
        Ok(copy) => Json(BookRef {
            book_uuid: copy.book_uuid,
        })
        .into_response(),
        Err(e) => scan_error("scan_check_in", e),
    }
}

/// Add a book you have only on paper
///
/// Creates a book with no files from provider metadata, such as the `online` of a
/// `not_in_library` outcome, and checks in its first copy under you. The cover at
/// `cover_url` is downloaded now, from the known provider hosts only; when that fails,
/// the book has no cover.
#[utoipa::path(
    post,
    path = "/api/scan/physical-only",
    tag = "Physical books",
    operation_id = "add_physical_only_book",
    request_body = AddPhysicalOnlyRequest,
    responses(
        (status = 200, description = "The new book.", body = BookRef),
        (status = 400, description = "A field of `meta` is too long, or `note` is longer than 4096 characters; the body says which."),
    ),
)]
pub(super) async fn post_add_physical_only(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<AddPhysicalOnlyRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::add_physical_only(&state.pool, &req.meta, req.note.as_deref(), Some(user.id)).await {
        Ok(book_uuid) => Json(BookRef { book_uuid }).into_response(),
        Err(e) => scan_error("scan_add_physical_only", e),
    }
}

/// Add a scanned book to your wishlist
///
/// Adds a book to your physical wishlist: a library book by `book_uuid`, or one the
/// library doesn't have from `meta`, which creates a book with no files to hold the
/// entry. When both are sent, `book_uuid` wins. A book already on your wishlist stays as
/// it was.
#[utoipa::path(
    post,
    path = "/api/scan/wishlist",
    tag = "Physical books",
    operation_id = "add_scanned_book_to_wishlist",
    request_body = WishlistAddRequest,
    responses(
        (status = 200, description = "The book is on your wishlist.", body = BookRef),
        (status = 400, description = "Neither `book_uuid` nor `meta` was sent, `book_uuid` is blank or longer than 64 bytes, or a field of `meta` is too long."),
        (status = 404, description = "No book has that `book_uuid`."),
    ),
)]
pub(super) async fn post_wishlist_add(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<WishlistAddRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::wishlist_add(
        &state.pool,
        user.id,
        req.book_uuid.as_deref(),
        req.meta.as_ref(),
        req.source,
    )
    .await
    {
        Ok(book_uuid) => Json(BookRef { book_uuid }).into_response(),
        Err(e) => scan_error("scan_wishlist_add", e),
    }
}

#[cfg(test)]
mod tests;
