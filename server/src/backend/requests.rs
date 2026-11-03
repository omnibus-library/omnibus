//! Reader REST handlers for book requests: starting one for a book, reading a book's
//! requests, and answering the search it runs. Every route answers 404 while the book-requests
//! flag is off, before the sign-in check, and 403 to a reader without the request permission.
//! Requests are visible to every reader who may request; only the requester or an admin acts
//! on one, and only an admin is shown the search's technical detail.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{
    extract::{FromRequestParts, Path, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    requests::store::{self, RequestError, RequestRow},
};
use omnibus_shared::{BookRequest, RequestKind, StartRequest};

use crate::auth::AuthUser;

use super::{internal, AppState};

/// Requests a reader may start (or retry) in [`START_WINDOW`].
const MAX_STARTS: usize = 10;
const START_WINDOW: Duration = Duration::from_secs(10 * 60);
/// Requests a reader may have live at once.
const MAX_LIVE: i64 = 5;

/// A signed-in reader who may request, on a server with book requests on. The flag is
/// checked first, so with it off even a signed-out caller gets 404.
pub(super) struct RequestsUser(pub(super) AuthUser);

impl FromRequestParts<AppState> for RequestsUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !state.book_requests() {
            return Err(StatusCode::NOT_FOUND.into_response());
        }
        let user = AuthUser::from_request_parts(parts, state).await?;
        if !(user.is_admin || user.can_request) {
            return Err((StatusCode::FORBIDDEN, "you can't make requests").into_response());
        }
        Ok(RequestsUser(user))
    }
}

/// When each reader started their recent requests, to cap the rate. In memory: a restart
/// forgets it, which only ever lets a few extra searches through.
#[derive(Default)]
pub(super) struct StartLog(Mutex<HashMap<i64, VecDeque<Instant>>>);

impl StartLog {
    /// Record a start by `user` and say whether they are within [`MAX_STARTS`] per
    /// [`START_WINDOW`]. A refused start is not recorded.
    pub(super) fn allow(&self, user: i64) -> bool {
        self.allow_at(user, Instant::now())
    }

    fn allow_at(&self, user: i64, now: Instant) -> bool {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let starts = map.entry(user).or_default();
        while starts
            .front()
            .is_some_and(|t| now.duration_since(*t) >= START_WINDOW)
        {
            starts.pop_front();
        }
        if starts.len() >= MAX_STARTS {
            return false;
        }
        starts.push_back(now);
        true
    }
}

/// The wire form of a stored request, with the versions found. The search's technical
/// detail goes only to an admin.
async fn view(state: &AppState, row: RequestRow, is_admin: bool) -> Result<BookRequest, Response> {
    let versions = store::versions(state.pool(), row.id)
        .await
        .map_err(|e| internal("read request versions", e))?;
    Ok(BookRequest {
        id: row.id,
        book_uuid: row.book_uuid,
        user_id: row.user_id,
        kind: row.kind,
        state: row.state,
        stuck_reason: row.stuck_reason,
        stuck_detail: row.stuck_detail.filter(|_| is_admin),
        chosen_result_id: row.chosen_result_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        versions,
    })
}

fn too_many(what: &str) -> Response {
    (StatusCode::TOO_MANY_REQUESTS, what.to_string()).into_response()
}

/// Start a request for a book
///
/// Asks for one digital format of the book and starts looking for versions of it; poll
/// `GET /api/requests/{id}` until it leaves `looking`. If you already have a live request for
/// that format of that book, it is returned instead with 200 and nothing new starts.
#[utoipa::path(
    post,
    path = "/api/books/{uuid}/requests",
    tag = "Requests",
    operation_id = "start_book_request",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = StartRequest,
    responses(
        (status = 201, description = "The request started.", body = BookRequest),
        (status = 200, description = "You already had a live request for this format; here it is.", body = BookRequest),
        (status = 400, description = "Only `ebook` can be requested yet."),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't make requests."),
        (status = 404, description = "Book requests are off on this server, or the book doesn't exist."),
        (status = 429, description = "You started too many requests lately, or have too many in progress."),
    ),
)]
pub(super) async fn post_start_request(
    RequestsUser(user): RequestsUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(body): Json<StartRequest>,
) -> Response {
    if body.kind != RequestKind::Ebook {
        return (StatusCode::BAD_REQUEST, "only ebooks can be requested yet").into_response();
    }
    let book_uuid = match db::resolve_canonical_book_uuid(state.pool(), &uuid).await {
        Ok(Some(u)) => u,
        Ok(None) => return (StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("resolve requested book", e),
    };
    if !state.request_starts().allow(user.id) {
        return too_many("you started too many requests; try again in a few minutes");
    }
    let started = match store::start(state.pool(), user.id, &book_uuid, body.kind, MAX_LIVE).await {
        Ok(s) => s,
        Err(RequestError::TooManyLive) => {
            return too_many("you have too many requests in progress");
        }
        Err(e) => return internal("start request", e),
    };
    let status = if started.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    match view(&state, started.request, user.is_admin).await {
        Ok(request) => (status, Json(request)).into_response(),
        Err(res) => res,
    }
}

/// List a book's requests
///
/// Every request made for the book, newest first, whoever made it. A book nobody has
/// requested has an empty list.
#[utoipa::path(
    get,
    path = "/api/books/{uuid}/requests",
    tag = "Requests",
    operation_id = "list_book_requests",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book's requests.", body = Vec<BookRequest>),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't make requests."),
        (status = 404, description = "Book requests are off on this server."),
    ),
)]
pub(super) async fn get_book_requests(
    RequestsUser(user): RequestsUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    let book_uuid = match db::resolve_canonical_book_uuid(state.pool(), &uuid).await {
        Ok(found) => found.unwrap_or(uuid),
        Err(e) => return internal("resolve requested book", e),
    };
    let rows = match store::list_for_book(state.pool(), &book_uuid).await {
        Ok(rows) => rows,
        Err(e) => return internal("list requests", e),
    };
    let mut requests = Vec::with_capacity(rows.len());
    for row in rows {
        match view(&state, row, user.is_admin).await {
            Ok(request) => requests.push(request),
            Err(res) => return res,
        }
    }
    Json(requests).into_response()
}

/// Get a request
///
/// One request and the versions found so far. Any reader who can make requests may read any
/// request. Only an admin is sent `stuck_detail`.
#[utoipa::path(
    get,
    path = "/api/requests/{id}",
    tag = "Requests",
    operation_id = "get_book_request",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The request.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't make requests."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
    ),
)]
pub(super) async fn get_request(
    RequestsUser(user): RequestsUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    let row = match store::get(state.pool(), id).await {
        Ok(Some(row)) => row,
        Ok(None) => return (StatusCode::NOT_FOUND, "request not found").into_response(),
        Err(e) => return internal("read request", e),
    };
    match view(&state, row, user.is_admin).await {
        Ok(request) => Json(request).into_response(),
        Err(res) => res,
    }
}

#[cfg(test)]
mod tests;
