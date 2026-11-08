//! Reader REST handlers for book requests: starting one for a book, listing every reader's
//! requests or one book's, answering the search it runs, and taking or keeping the cover a
//! finished download brought. Every route answers 404 while the book-requests flag is off,
//! before the sign-in check. Requests are visible to every signed-in reader; starting one needs
//! the permission to ask, acting on any reader's needs the permission to pick versions (the
//! maker may always cancel their own), and only an admin is shown the search's technical detail.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    requests::{
        cover,
        search::run_search,
        store::{self, ListFilter, RequestError, RequestRow},
    },
};
use omnibus_shared::{
    BookRequest, ChooseVersion, FileBytes, RequestListQuery, RequestListing, RequestState,
    StartRequest, StartRequestFromMeta, StuckReason,
};

use crate::auth::AuthUser;

use super::{internal, overrides, AppState};

mod access;

use access::{
    cancellable_request, chooser_request, find, may_choose, restorable_request, RequestsUser,
    RequestsViewer,
};

/// Requests a reader may start (or retry) in [`START_WINDOW`].
const MAX_STARTS: usize = 10;
const START_WINDOW: Duration = Duration::from_secs(10 * 60);
/// Requests a reader may have live at once.
const MAX_LIVE: i64 = 5;

/// When each reader started their recent requests, to cap the rate. In memory: a restart
/// forgets it, which only ever lets a few extra searches through.
#[derive(Default)]
pub(super) struct StartLog(Mutex<HashMap<i64, VecDeque<Instant>>>);

impl StartLog {
    /// Whether `user` may start another request: fewer than [`MAX_STARTS`] in [`START_WINDOW`].
    pub(super) fn has_room(&self, user: i64) -> bool {
        self.has_room_at(user, Instant::now())
    }

    /// Count a start by `user` now.
    pub(super) fn record(&self, user: i64) {
        self.record_at(user, Instant::now());
    }

    fn has_room_at(&self, user: i64, now: Instant) -> bool {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let starts = map.entry(user).or_default();
        while starts
            .front()
            .is_some_and(|t| now.duration_since(*t) >= START_WINDOW)
        {
            starts.pop_front();
        }
        starts.len() < MAX_STARTS
    }

    fn record_at(&self, user: i64, now: Instant) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(user).or_default().push_back(now);
    }
}

/// The wire form of a stored request, with no versions. The search's technical detail goes
/// only to an admin.
fn summary(row: RequestRow, is_admin: bool) -> BookRequest {
    BookRequest {
        id: row.id,
        book_uuid: row.book_uuid,
        user_id: row.user_id,
        kind: row.kind,
        state: row.state,
        stuck_reason: row.stuck_reason,
        stuck_detail: row.stuck_detail.filter(|_| is_admin),
        chosen_result_id: row.chosen_result_id,
        progress: row.progress,
        expected_done_at: row.expected_done_at,
        cancel_at: row.cancel_at,
        cancelled_by: row.cancelled_by,
        note: row.note,
        created_at: row.created_at,
        updated_at: row.updated_at,
        cover_offer: None,
        versions: Vec::new(),
    }
}

/// [`summary`] plus the versions found and, to whoever may pick versions, the cover on offer.
async fn view(
    state: &AppState,
    row: RequestRow,
    viewer: &AuthUser,
) -> Result<BookRequest, Response> {
    let versions = store::versions(state.pool(), row.id)
        .await
        .map_err(|e| internal("read request versions", e))?;
    let cover_offer = if may_choose(viewer) {
        cover::offer(state.pool(), &row)
            .await
            .map_err(|e| internal("read request cover offer", e))?
            .map(|offer| offer.sizes)
    } else {
        None
    };
    Ok(BookRequest {
        versions,
        cover_offer,
        ..summary(row, viewer.is_admin)
    })
}

/// Request `id` as the answer to `viewer`: 404 when it is gone.
async fn answer(state: &AppState, id: i64, viewer: &AuthUser) -> Response {
    let row = match find(state, id).await {
        Ok(row) => row,
        Err(res) => return res,
    };
    match view(state, row, viewer).await {
        Ok(request) => Json(request).into_response(),
        Err(res) => res,
    }
}

/// Look for versions of the request's book in the background, once its row is committed.
fn spawn_search(state: &AppState, id: i64) {
    let pool = state.pool().clone();
    tokio::spawn(async move {
        if let Err(e) = run_search(&pool, id).await {
            tracing::error!(error = %e, request = id, "request search failed to record");
        }
    });
}

/// What the history says of a version given up for another.
const SWAPPED: &str = "Swapped for another version";

/// Search again for request `id`, charged to `user` like a start.
fn search_again(state: &AppState, user: i64, id: i64) {
    state.request_starts().record(user);
    spawn_search(state, id);
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
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't ask for books."),
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
    let book_uuid = match db::resolve_canonical_book_uuid(state.pool(), &uuid).await {
        Ok(Some(u)) => u,
        Ok(None) => return (StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("resolve requested book", e),
    };
    if !state.request_starts().has_room(user.id) {
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
        search_again(&state, user.id, started.request.id);
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    match view(&state, started.request, &user).await {
        Ok(request) => (status, Json(request)).into_response(),
        Err(res) => res,
    }
}

/// Start a request for a book the library lacks
///
/// Makes the book from a provider's record of it, without files, and starts looking for the
/// format you asked for; poll `GET /api/requests/{id}` until it leaves `looking`. No wishlist
/// entry is made. To request a book the library already has, use `POST /api/books/{uuid}/requests`.
#[utoipa::path(
    post,
    path = "/api/requests",
    tag = "Requests",
    operation_id = "start_request_from_metadata",
    request_body = StartRequestFromMeta,
    responses(
        (status = 201, description = "The book was made and the request started.", body = BookRequest),
        (status = 400, description = "A field of `meta` is over its length cap."),
        (status = 403, description = "Your account can't ask for books."),
        (status = 404, description = "Book requests are off on this server."),
        (status = 429, description = "You started too many requests lately, or have too many in progress."),
    ),
)]
pub(super) async fn post_start_request_from_meta(
    RequestsUser(user): RequestsUser,
    State(state): State<AppState>,
    Json(body): Json<StartRequestFromMeta>,
) -> Response {
    if let Err(message) = body.validate() {
        return (StatusCode::BAD_REQUEST, message).into_response();
    }
    if !state.request_starts().has_room(user.id) {
        return too_many("you started too many requests; try again in a few minutes");
    }
    let row =
        match store::start_for_new_book(state.pool(), user.id, &body.meta, body.kind, MAX_LIVE)
            .await
        {
            Ok(row) => row,
            Err(RequestError::TooManyLive) => {
                return too_many("you have too many requests in progress");
            }
            Err(e) => return internal("start request on a new book", e),
        };
    search_again(&state, user.id, row.id);
    match view(&state, row, &user).await {
        Ok(request) => (StatusCode::CREATED, Json(request)).into_response(),
        Err(res) => res,
    }
}

/// The requests `filter` matches, as the answer to `viewer`, each with the versions it picked
/// and gave up.
async fn list_answer(state: &AppState, filter: ListFilter<'_>, viewer: &AuthUser) -> Response {
    let listed = match store::list(state.pool(), filter).await {
        Ok(listed) => listed,
        Err(e) => return internal("list requests", e),
    };
    let listings: Vec<RequestListing> = listed
        .into_iter()
        .map(|l| RequestListing {
            request: BookRequest {
                versions: l.versions,
                ..summary(l.request, viewer.is_admin)
            },
            book: l.book,
            requester_name: l.requester_name,
            requester_has_avatar: l.requester_has_avatar,
            cancelled_by_name: l.cancelled_by_name,
        })
        .collect();
    Json(listings).into_response()
}

/// List a book's requests
///
/// The book's history: every request made for it, newest first, whoever made it, with who
/// made it and who cancelled it. Each carries only the version it picked and the versions it
/// gave up; read one request for the rest. A book nobody has requested has an empty list.
/// Any signed-in reader may read it.
#[utoipa::path(
    get,
    path = "/api/books/{uuid}/requests",
    tag = "Requests",
    operation_id = "list_book_requests",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book's requests.", body = Vec<RequestListing>),
        (status = 401, description = "You aren't signed in."),
        (status = 404, description = "Book requests are off on this server."),
    ),
)]
pub(super) async fn get_book_requests(
    RequestsViewer(viewer): RequestsViewer,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    let book_uuid = match db::resolve_canonical_book_uuid(state.pool(), &uuid).await {
        Ok(found) => found.unwrap_or(uuid),
        Err(e) => return internal("resolve requested book", e),
    };
    let filter = ListFilter {
        book_uuid: Some(&book_uuid),
        ..ListFilter::default()
    };
    list_answer(&state, filter, &viewer).await
}

/// List requests
///
/// Every reader's requests, newest first, in every state, with who made each and who
/// cancelled it, narrowed by `state` and `user` when given. Requests are public on the
/// server, so any signed-in reader may read them. Each carries only the version it picked and
/// the versions it gave up. Every `ready` request is returned, and at most the newest 500 of the rest.
#[utoipa::path(
    get,
    path = "/api/requests",
    tag = "Requests",
    operation_id = "list_requests",
    params(RequestListQuery),
    responses(
        (status = 200, description = "The requests.", body = Vec<RequestListing>),
        (status = 400, description = "`state` isn't a request state, or `user` isn't a number."),
        (status = 404, description = "Book requests are off on this server."),
    ),
)]
pub(super) async fn get_requests(
    RequestsViewer(viewer): RequestsViewer,
    State(state): State<AppState>,
    Query(query): Query<RequestListQuery>,
) -> Response {
    let filter = ListFilter {
        user_id: query.user,
        state: query.state,
        ..ListFilter::default()
    };
    list_answer(&state, filter, &viewer).await
}

/// Get a request
///
/// One request and the versions found so far. Any signed-in reader may read any request.
/// Only an admin is sent `stuck_detail`.
#[utoipa::path(
    get,
    path = "/api/requests/{id}",
    tag = "Requests",
    operation_id = "get_book_request",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The request.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
    ),
)]
pub(super) async fn get_request(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    answer(&state, id, &user).await
}

/// Get a request's downloaded cover
///
/// The cover that came with the request's finished download, offered as a replacement for the
/// book's own: the image as stored, validated by its `ETag`. It is there while `cover_offer` is
/// on the request, until the offer is taken or kept (`POST` or `DELETE` on this path). Only a
/// reader who can pick versions, or an admin, is offered it.
#[utoipa::path(
    get,
    path = "/api/requests/{id}/cover",
    tag = "Requests",
    operation_id = "get_request_cover",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The cover image.", body = FileBytes, content_type = "image/*"),
        (status = 304, description = "The cover is unchanged since the `ETag` sent in `If-None-Match`."),
        (status = 401, description = "You aren't signed in."),
        (status = 404, description = "Book requests are off on this server, there is no such request, or it has no cover on offer to you."),
    ),
)]
pub(super) async fn get_request_cover(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Response {
    let row = match find(&state, id).await {
        Ok(row) => row,
        Err(res) => return res,
    };
    let offered = if may_choose(&user) {
        cover::offer(state.pool(), &row).await
    } else {
        Ok(None)
    };
    match offered {
        Ok(Some(offer)) => super::covers::image_response(&headers, &offer.mime, offer.bytes),
        Ok(None) => (StatusCode::NOT_FOUND, "no cover on offer").into_response(),
        Err(e) => internal("read request cover offer", e),
    }
}

/// Use the downloaded cover
///
/// Makes the cover the finished download brought the book's cover, the way uploading one
/// does: it shows on every device, and a synced Kobo fetches it on its next sync. Only a
/// `ready` request whose offer is still on (`cover_offer` in the request) takes it, and the
/// offer is gone afterwards. Only a reader who can pick versions, or an admin, can do this.
#[utoipa::path(
    post,
    path = "/api/requests/{id}/cover",
    tag = "Requests",
    operation_id = "take_request_cover",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The book has the downloaded cover; the offer is gone.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't pick versions."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
        (status = 409, description = "No cover is on offer: it was taken or kept, or the downloaded one is not sharper."),
    ),
)]
pub(super) async fn post_take_request_cover(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    let row = match chooser_request(&state, &user, id).await {
        Ok(row) => row,
        Err(res) => return res,
    };
    let nothing = || (StatusCode::CONFLICT, "no cover is on offer").into_response();
    let offer = match cover::offer(state.pool(), &row).await {
        Ok(Some(offer)) => offer,
        Ok(None) => return nothing(),
        Err(e) => return internal("read request cover offer", e),
    };
    let Some(candidate) = row.cover_candidate.as_deref() else {
        return nothing();
    };
    match cover::settle(state.pool(), id, candidate).await {
        Ok(()) => {}
        Err(RequestError::WrongState) => return nothing(),
        Err(e) => return internal("settle request cover", e),
    }
    let (mime, bytes) = (offer.mime, Bytes::from(offer.bytes));
    if let Err(e) = overrides::persist_cover(&state, &row.book_uuid, user.id, mime, bytes).await {
        // The old cover stands, so the offer must too.
        if let Err(restore) = cover::reopen(state.pool(), id, candidate).await {
            tracing::error!(error = %restore, request = id, "restoring a cover offer");
        }
        return internal(e.context, e.detail);
    }
    cover::discard(id).await;
    // The cover is stored; a stale thumbnail is only logged, not undone.
    let book_id = offer.book_id;
    if let Err(e) =
        tokio::task::spawn_blocking(move || db::thumbs::invalidate_thumbs(book_id)).await
    {
        tracing::error!(error = %e, request = id, "invalidating thumbs after taking a cover");
    }
    answer(&state, id, &user).await
}

/// Keep the book's cover
///
/// Turns the downloaded cover down: the book keeps the cover it has, and the offer is gone
/// for good. Only a reader who can pick versions, or an admin, can do this.
#[utoipa::path(
    delete,
    path = "/api/requests/{id}/cover",
    tag = "Requests",
    operation_id = "keep_request_cover",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The offer is gone.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't pick versions."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
        (status = 409, description = "No cover is on offer: it was already taken or kept."),
    ),
)]
pub(super) async fn delete_keep_request_cover(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    let row = match chooser_request(&state, &user, id).await {
        Ok(row) => row,
        Err(res) => return res,
    };
    let settled = match &row.cover_candidate {
        Some(candidate) => cover::settle(state.pool(), id, candidate).await,
        None => Err(RequestError::WrongState),
    };
    match settled {
        Ok(()) => {
            cover::discard(id).await;
            answer(&state, id, &user).await
        }
        Err(RequestError::WrongState) => {
            (StatusCode::CONFLICT, "no cover is on offer").into_response()
        }
        Err(e) => internal("settle request cover", e),
    }
}

/// Try a request again
///
/// Searches again for a request that is `stuck` or still `looking`, and puts it back to
/// `looking`; poll `GET /api/requests/{id}` as after a start. That counts as a start toward
/// the rate limit. A request stuck on a stopped download (`stopped_moving`) instead drops that
/// download and goes back to `choose` among the other versions, with nothing searched and
/// nothing counted. One stuck because its finished download could not be added to the library
/// (`couldnt_add`) goes back to `on_its_way` and only the adding is tried again: the download
/// is kept, nothing is searched or fetched, and nothing is counted. Only a reader who can pick
/// versions, or an admin, can do this.
#[utoipa::path(
    post,
    path = "/api/requests/{id}/retry",
    tag = "Requests",
    operation_id = "retry_book_request",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The request is looking again, choosing again after a stopped download, or on its way again after a download that could not be added.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't pick versions."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
        (status = 409, description = "The request is past searching: it is waiting on a pick or was picked, or its download can't be added again because you asked for the same book since."),
        (status = 429, description = "You started too many requests lately, or have too many in progress."),
    ),
)]
pub(super) async fn post_retry_request(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    let row = match chooser_request(&state, &user, id).await {
        Ok(row) => row,
        Err(res) => return res,
    };
    // Only a search counts toward the cap; these two stuck requests are not searched.
    let searches = !(row.state == RequestState::Stuck
        && matches!(
            row.stuck_reason,
            Some(StuckReason::StoppedMoving | StuckReason::CouldntAdd)
        ));
    if searches && !state.request_starts().has_room(user.id) {
        return too_many("you started too many requests; try again in a few minutes");
    }
    match store::restart(state.pool(), id, store::unix_now(), MAX_LIVE).await {
        Ok(RequestState::Looking) => search_again(&state, user.id, id),
        Ok(_) => state.request_kick().notify_one(),
        Err(RequestError::WrongState) => {
            return (StatusCode::CONFLICT, "this request can't be searched again").into_response();
        }
        Err(RequestError::TooManyLive) => {
            return too_many("you have too many requests in progress");
        }
        Err(e) => return internal("restart request", e),
    }
    answer(&state, id, &user).await
}

/// Pick another version
///
/// Gives up the version that is downloading (or has stopped) for good and goes back to
/// `choose` among the other versions found; the download is removed a moment later. The
/// request carries a `note` saying so, and the version is listed with `rejected` set. With no
/// other version left it searches again and is `looking`, which counts as a start toward the
/// rate limit. Only a request that is `on_its_way` and not fully downloaded, or stuck on a
/// stopped download, can be swapped. Only a reader who can pick versions, or an admin, can do
/// this.
#[utoipa::path(
    post,
    path = "/api/requests/{id}/swap",
    tag = "Requests",
    operation_id = "swap_request_version",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The request is choosing again (or looking, with nothing else to choose).", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't pick versions."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
        (status = 409, description = "The request isn't downloading, or its download is complete."),
        (status = 429, description = "It would need a new search and you started too many requests lately."),
    ),
)]
pub(super) async fn post_swap_request(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    if let Err(res) = chooser_request(&state, &user, id).await {
        return res;
    }
    // With no other version to choose from, the swap searches again, which counts as a start.
    let others = match store::versions(state.pool(), id).await {
        Ok(versions) => versions.iter().filter(|v| !v.rejected).count(),
        Err(e) => return internal("read request versions", e),
    };
    if others <= 1 && !state.request_starts().has_room(user.id) {
        return too_many("you started too many requests; try again in a few minutes");
    }
    match store::swap(state.pool(), id, store::unix_now(), Some(SWAPPED)).await {
        Ok(swapped) => {
            if swapped.state == RequestState::Looking {
                search_again(&state, user.id, id);
            }
            state.request_kick().notify_one();
            answer(&state, id, &user).await
        }
        Err(RequestError::WrongState) => {
            (StatusCode::CONFLICT, "this request has no download to swap").into_response()
        }
        Err(e) => internal("swap version", e),
    }
}

/// Choose a version
///
/// Picks one of the versions a request found, which ends the choosing. Only a request in
/// `choose` takes a pick, and only a version the request offers. The body carries the
/// version's `id` and nothing else. Only a reader who can pick versions, or an admin, can pick.
#[utoipa::path(
    post,
    path = "/api/requests/{id}/choose",
    tag = "Requests",
    operation_id = "choose_request_version",
    params(("id" = i64, Path, description = "The request's id.")),
    request_body = ChooseVersion,
    responses(
        (status = 200, description = "The version is picked; the request is now `chosen`.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't pick versions."),
        (status = 404, description = "Book requests are off on this server, or there is no such request or version."),
        (status = 409, description = "The request isn't waiting on a pick."),
        (status = 422, description = "The body isn't just a version id."),
    ),
)]
pub(super) async fn post_choose_version(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<ChooseVersion>,
) -> Response {
    if let Err(res) = chooser_request(&state, &user, id).await {
        return res;
    }
    match store::choose(state.pool(), id, body.result_id).await {
        Ok(()) => {
            state.request_kick().notify_one();
            answer(&state, id, &user).await
        }
        Err(RequestError::NotFound) => (StatusCode::NOT_FOUND, "version not found").into_response(),
        Err(RequestError::WrongState) => {
            (StatusCode::CONFLICT, "this request isn't waiting on a pick").into_response()
        }
        Err(e) => internal("choose version", e),
    }
}

/// Cancel a request
///
/// The request reads `cancelled` at once. The download is told to stop a few seconds later
/// (see `cancel_at`), so `DELETE /api/requests/{id}/cancel` can take the cancel back until
/// then. Only a request that is searching, waiting on a pick, picked or still downloading can
/// be cancelled. Only the reader who made the request, a reader who can pick versions, or an
/// admin, can do this.
#[utoipa::path(
    post,
    path = "/api/requests/{id}/cancel",
    tag = "Requests",
    operation_id = "cancel_book_request",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The request is cancelled; undo it until `cancel_at`.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "The request is another reader's and your account can't pick versions."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
        (status = 409, description = "The request can't be cancelled now: it is stuck, already cancelled or fully downloaded."),
    ),
)]
pub(super) async fn post_cancel_request(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    if let Err(res) = cancellable_request(&state, &user, id).await {
        return res;
    }
    match store::cancel(state.pool(), id, user.id, store::unix_now()).await {
        Ok(()) => {
            state.request_kick().notify_one();
            answer(&state, id, &user).await
        }
        Err(RequestError::WrongState) => {
            (StatusCode::CONFLICT, "this request can't be cancelled").into_response()
        }
        Err(e) => internal("cancel request", e),
    }
}

/// Undo a cancel
///
/// Takes a cancel back while its grace lasts (until `cancel_at`), putting the request in the
/// state it was cancelled from; a request cancelled while looking searches again, which counts
/// as a start. After the grace the download is stopped and cannot be undone, nor can a cancel
/// once you started another request for the same book. Only a reader who can pick versions, an
/// admin, or the reader who made the request while they can ask for books, can do this.
#[utoipa::path(
    delete,
    path = "/api/requests/{id}/cancel",
    tag = "Requests",
    operation_id = "undo_cancel_book_request",
    params(("id" = i64, Path, description = "The request's id.")),
    responses(
        (status = 200, description = "The request is back as it was.", body = BookRequest),
        (status = 401, description = "You aren't signed in."),
        (status = 403, description = "Your account can't ask for books or pick versions, or the request is another reader's and it can't pick versions."),
        (status = 404, description = "Book requests are off on this server, or there is no such request."),
        (status = 409, description = "The request isn't cancelled, the undo grace has ended, or you have started another request for this book."),
        (status = 429, description = "You started too many requests lately, or have too many in progress to restore this one."),
    ),
)]
pub(super) async fn delete_cancel_request(
    RequestsViewer(user): RequestsViewer,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    if let Err(res) = restorable_request(&state, &user, id).await {
        return res;
    }
    // Undoing a cancel starts the request again, so it counts like a start.
    if !state.request_starts().has_room(user.id) {
        return too_many("you started too many requests; try again in a few minutes");
    }
    match store::undo_cancel(state.pool(), id, store::unix_now(), MAX_LIVE).await {
        Ok(restored) => {
            // A search cut short by the cancel left nothing behind, so look again.
            if restored.state == RequestState::Looking {
                search_again(&state, user.id, id);
            }
            answer(&state, id, &user).await
        }
        Err(RequestError::WrongState) => {
            (StatusCode::CONFLICT, "this cancel can't be undone").into_response()
        }
        Err(RequestError::TooManyLive) => too_many("you have too many requests in progress"),
        Err(e) => internal("undo cancel", e),
    }
}

#[cfg(test)]
mod tests;
