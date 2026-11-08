//! Who may do what on a book request: the extractors that gate a route on the flag and the
//! permission to ask, `may_choose` for the permission to pick versions, and the guards that
//! load a request for a reader allowed to act on it. Shared by every handler in `requests`.

use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
};
use omnibus_db::requests::store::{self, RequestRow};

use crate::auth::AuthUser;
use crate::backend::{internal, AppState};

/// A signed-in reader on a server with book requests on. The flag is checked first, so with
/// it off even a signed-out caller gets 404. Every reader may see requests; see
/// [`RequestsUser`] for who may make them and [`may_choose`] for who may act on them.
pub struct RequestsViewer(pub AuthUser);

impl FromRequestParts<AppState> for RequestsViewer {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !state.book_requests() {
            return Err(StatusCode::NOT_FOUND.into_response());
        }
        Ok(RequestsViewer(
            AuthUser::from_request_parts(parts, state).await?,
        ))
    }
}

/// A [`RequestsViewer`] who may also make requests: an admin, or a reader who may ask for books.
pub struct RequestsUser(pub AuthUser);

impl FromRequestParts<AppState> for RequestsUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let RequestsViewer(user) = RequestsViewer::from_request_parts(parts, state).await?;
        if !(user.is_admin || user.can_start_requests) {
            return Err((StatusCode::FORBIDDEN, "you can't ask for books").into_response());
        }
        Ok(RequestsUser(user))
    }
}

/// Whether `user` may pick versions: an admin, or a reader granted it. They act on any reader's
/// request and are the only ones offered a downloaded cover.
pub fn may_choose(user: &AuthUser) -> bool {
    user.is_admin || user.can_choose_request_versions
}

/// Request `id`, or the 404 or 500 to send.
pub async fn find(state: &AppState, id: i64) -> Result<RequestRow, Response> {
    match store::get(state.pool(), id).await {
        Ok(Some(row)) => Ok(row),
        Ok(None) => Err((StatusCode::NOT_FOUND, "request not found").into_response()),
        Err(e) => Err(internal("read request", e)),
    }
}

/// Request `id` for a reader who may pick versions; else the 403, sent before the request is
/// looked up, or the 404 or 500 to send.
pub async fn chooser_request(
    state: &AppState,
    user: &AuthUser,
    id: i64,
) -> Result<RequestRow, Response> {
    if !may_choose(user) {
        return Err((StatusCode::FORBIDDEN, "you can't pick versions").into_response());
    }
    find(state, id).await
}

/// Request `id` if it exists and `user` made it or may pick versions; else the 404 or 403 to send.
pub async fn cancellable_request(
    state: &AppState,
    user: &AuthUser,
    id: i64,
) -> Result<RequestRow, Response> {
    let row = find(state, id).await?;
    if !may_choose(user) && row.user_id != user.id {
        return Err((StatusCode::FORBIDDEN, "this isn't your request").into_response());
    }
    Ok(row)
}
