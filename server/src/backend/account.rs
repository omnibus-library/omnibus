//! `/api/account/*` — the caller's own reading preferences: hidden formats,
//! book-detail scroll stops, Stack series, and share stats. Mirrors the web
//! server functions in `frontend::rpc::account`; the read sides ride
//! `GET /api/auth/me` as `UserSummary` fields.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
use omnibus_shared::{SetBookDetailScrollStops, SetHiddenFormats, SetShareStats, SetStackSeries};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Set your hidden formats
///
/// Replaces the list of formats your library view leaves out. Clients pass the saved list,
/// read back as `hidden_formats` on `GET /api/auth/me`, as the listing's `exclude_formats`.
#[utoipa::path(
    post,
    path = "/api/account/hidden-formats",
    tag = "Account",
    request_body = SetHiddenFormats,
    responses(
        (status = 200, description = "The list is saved."),
        (status = 422, description = "A format name isn't 1 to 16 letters or digits, or the list has more than 32; the body says which."),
    ),
)]
pub(super) async fn post_hidden_formats(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SetHiddenFormats>,
) -> Response {
    match db::auth::set_hidden_formats(&state.pool, user.id, &body.formats).await {
        Ok(_) => StatusCode::OK.into_response(),
        Err(db::auth::AuthError::Validation(msg)) => {
            (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response()
        }
        Err(e) => internal("set hidden formats", e),
    }
}

/// Set book-detail scroll stops
///
/// Chooses whether a book's detail page stops at each section as you scroll. Read back as
/// `book_detail_scroll_stops` on `GET /api/auth/me`.
#[utoipa::path(
    post,
    path = "/api/account/book-detail-scroll-stops",
    tag = "Account",
    request_body = SetBookDetailScrollStops,
    responses((status = 200, description = "The preference is saved.")),
)]
pub(super) async fn post_book_detail_scroll_stops(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SetBookDetailScrollStops>,
) -> Response {
    match db::auth::set_book_detail_scroll_stops(&state.pool, user.id, body.enabled).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal("set book detail scroll stops", e),
    }
}

/// Set series stacking
///
/// Chooses whether your library grid folds each series into one tile. Read back as
/// `stack_series` on `GET /api/auth/me`.
#[utoipa::path(
    post,
    path = "/api/account/stack-series",
    tag = "Account",
    request_body = SetStackSeries,
    responses((status = 200, description = "The preference is saved.")),
)]
pub(super) async fn post_stack_series(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SetStackSeries>,
) -> Response {
    match db::auth::set_stack_series(&state.pool, user.id, body.enabled).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal("set stack series", e),
    }
}

/// Set stats sharing
///
/// Chooses whether other readers on this server can see your reading stats. Read back as
/// `share_stats` on `GET /api/auth/me`.
#[utoipa::path(
    post,
    path = "/api/account/share-stats",
    tag = "Account",
    request_body = SetShareStats,
    responses((status = 200, description = "The preference is saved.")),
)]
pub(super) async fn post_share_stats(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SetShareStats>,
) -> Response {
    // `enabled` has no serde default, so a body without it is rejected, never written.
    match db::auth::set_share_stats(&state.pool, user.id, body.enabled).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => internal("set share stats", e),
    }
}

#[cfg(test)]
mod tests;
