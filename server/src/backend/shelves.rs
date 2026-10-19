//! Shelf REST handlers for the mobile client (`/api/shelves*`): list the
//! caller's visible shelves, create/update/delete a shelf, edit hand-picked
//! membership, and preview an unsaved smart rule. A shelf is visible to its
//! owner, any admin, or — when public — everyone; mutations require
//! owner-or-admin. Web clients use the parallel `/api/rpc/shelves*` RPCs.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, shelves::ShelfError};
use omnibus_shared::{
    AddBooksRequest, CreateShelfRequest, RulePreview, RulePreviewRequest, Shelf, ShelfPage,
    ShelfPageQuery, ShelfSummary, UpdateShelfRequest,
};

use super::{internal, AppState};
use crate::auth::AuthUser;
use crate::http_errors::invalid_filter;

/// List shelves
///
/// Every shelf you can see: your own, every public shelf, and every shelf at all when you
/// are an admin. Each comes with its book count and up to four member uuids for a cover
/// mosaic.
#[utoipa::path(
    get,
    path = "/api/shelves",
    tag = "Shelves",
    responses((status = 200, description = "The shelves you can see.", body = Vec<ShelfSummary>)),
)]
pub(super) async fn list_shelves(user: AuthUser, State(state): State<AppState>) -> Response {
    match db::list_visible_shelves(&state.pool, user.id, user.is_admin).await {
        Ok(shelves) => Json(shelves).into_response(),
        Err(e) => map_err(e),
    }
}

/// List the hand-picked shelves holding a book
///
/// The ids of the hand-picked shelves you can see that hold the book, for a "which shelves
/// is this on" checklist. An unknown uuid is on no shelf, so the list is empty.
#[utoipa::path(
    get,
    path = "/api/shelves/containing/{uuid}",
    tag = "Shelves",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "Ids of the shelves holding the book.", body = Vec<i64>)),
)]
pub(super) async fn shelves_containing(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    // Saves a client fetching every shelf's page to answer this for one book.
    match db::shelves::manual_shelves_containing(&state.pool, user.id, user.is_admin, &uuid).await {
        Ok(ids) => Json(ids).into_response(),
        Err(e) => map_err(e),
    }
}

/// List the smart shelves matching a book
///
/// The ids of the smart shelves you can see whose rules match the book right now. Kept
/// apart from `GET /api/shelves/containing/{uuid}` because a smart shelf's membership
/// can't be toggled. An unknown uuid matches nothing, so the list is empty.
#[utoipa::path(
    get,
    path = "/api/shelves/containing/{uuid}/smart",
    tag = "Shelves",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "Ids of the smart shelves matching the book.", body = Vec<i64>)),
)]
pub(super) async fn smart_shelves_containing(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::shelves::smart_shelves_containing(&state.pool, user.id, user.is_admin, &uuid).await {
        Ok(ids) => Json(ids).into_response(),
        Err(e) => map_err(e),
    }
}

/// Create a shelf
///
/// Creates a shelf you own. A smart shelf needs `match_mode` and at least one rule, and
/// takes no `book_uuids`. A hand-picked shelf takes no rules, and can start with
/// `book_uuids`. A `wishlist` shelf can't be created: every reader has one already.
#[utoipa::path(
    post,
    path = "/api/shelves",
    tag = "Shelves",
    request_body = CreateShelfRequest,
    responses(
        (status = 201, description = "The new shelf.", body = Shelf),
        (status = 404, description = "A uuid in `book_uuids` matches no book."),
        (status = 409, description = "You already have a shelf with that name."),
        (status = 422, description = "The name, description, rules or `book_uuids` are invalid; the body says which."),
    ),
)]
pub(super) async fn create_shelf(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateShelfRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
    }
    match db::create_shelf(&state.pool, user.id, &req).await {
        Ok(shelf) => (StatusCode::CREATED, Json(shelf)).into_response(),
        Err(e) => map_err(e),
    }
}

/// Get a shelf
///
/// One shelf's details, with its rules when it is a smart shelf.
#[utoipa::path(
    get,
    path = "/api/shelves/{id}",
    tag = "Shelves",
    params(("id" = i64, Path, description = "The shelf's id.")),
    responses(
        (status = 200, description = "The shelf.", body = Shelf),
        (status = 404, description = "No shelf has that id, or it is another reader's private shelf."),
    ),
)]
pub(super) async fn get_shelf(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match load_for_view(&state, id, &user).await {
        Ok(shelf) => Json(shelf).into_response(),
        Err(resp) => resp,
    }
}

/// List a shelf's books
///
/// The books on a shelf, narrowed by `filter`. A smart shelf lists them in the order
/// `sort` and `dir` ask for; a hand-picked shelf lists them in the order they were added.
/// There is no paging: the list stops at 50,000 books.
#[utoipa::path(
    get,
    path = "/api/shelves/{id}/page",
    tag = "Shelves",
    params(("id" = i64, Path, description = "The shelf's id."), ShelfPageQuery),
    responses(
        (status = 200, description = "The shelf's books.", body = ShelfPage),
        (status = 400, description = "`filter` is malformed."),
        (status = 404, description = "No shelf has that id, or it is another reader's private shelf."),
        (status = 422, description = "A rule on the smart shelf holds a value that can't be evaluated, such as a year that isn't a number."),
    ),
)]
pub(super) async fn get_shelf_page(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<ShelfPageQuery>,
) -> Response {
    // A bad filter is a 400 before the view check runs.
    let filters = match q.filters() {
        Ok(f) => f,
        Err(reason) => return invalid_filter(&reason),
    };
    let shelf = match load_for_view(&state, id, &user).await {
        Ok(s) => s,
        Err(resp) => return resp,
    };
    let viewer = db::Viewer {
        user_id: user.id,
        is_admin: user.is_admin,
    };
    match db::shelf_page(
        &state.pool,
        &shelf,
        q.sort_key(),
        q.sort_dir(),
        &filters,
        viewer,
    )
    .await
    {
        Ok(page) => Json(page).into_response(),
        Err(e) => map_err(e),
    }
}

/// Update a shelf
///
/// Changes the fields you send and leaves the rest. `rules` replaces the whole rule set.
/// Only the shelf's owner or an admin can change it, and the Wishlist shelf can't be
/// changed at all.
#[utoipa::path(
    patch,
    path = "/api/shelves/{id}",
    tag = "Shelves",
    params(("id" = i64, Path, description = "The shelf's id.")),
    request_body = UpdateShelfRequest,
    responses(
        (status = 200, description = "The updated shelf.", body = Shelf),
        (status = 403, description = "The shelf is someone else's, or it is the Wishlist shelf."),
        (status = 404, description = "No shelf has that id, or it is another reader's private shelf."),
        (status = 409, description = "You already have a shelf with that name."),
        (status = 422, description = "A field is invalid, or the change would give a hand-picked shelf rules or leave a smart shelf with none; the body says which."),
    ),
)]
pub(super) async fn update_shelf(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateShelfRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
    }
    if let Err(resp) = load_for_edit(&state, id, &user).await {
        return resp;
    }
    match db::update_shelf(&state.pool, id, &req).await {
        Ok(shelf) => Json(shelf).into_response(),
        Err(e) => map_err(e),
    }
}

/// Delete a shelf
///
/// Deletes the shelf, its rules and its list of books; the books stay in the library.
/// Only the shelf's owner or an admin can delete it, and the Wishlist shelf can't be
/// deleted.
#[utoipa::path(
    delete,
    path = "/api/shelves/{id}",
    tag = "Shelves",
    params(("id" = i64, Path, description = "The shelf's id.")),
    responses(
        (status = 204, description = "The shelf is deleted."),
        (status = 403, description = "The shelf is someone else's, or it is the Wishlist shelf."),
        (status = 404, description = "No shelf has that id, or it is another reader's private shelf."),
    ),
)]
pub(super) async fn delete_shelf(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    if let Err(resp) = load_for_edit(&state, id, &user).await {
        return resp;
    }
    match db::delete_shelf(&state.pool, id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e),
    }
}

/// Add books to a shelf
///
/// Appends books to a hand-picked shelf. A book already on it stays where it is. Every
/// uuid must match a book, or nothing is added. Only the shelf's owner or an admin can
/// add books, and the Wishlist shelf can't be edited this way.
#[utoipa::path(
    post,
    path = "/api/shelves/{id}/books",
    tag = "Shelves",
    params(("id" = i64, Path, description = "The shelf's id.")),
    request_body = AddBooksRequest,
    responses(
        (status = 204, description = "The books are on the shelf."),
        (status = 403, description = "The shelf is someone else's, or it is the Wishlist shelf."),
        (status = 404, description = "No shelf has that id, it is another reader's private shelf, or a uuid matches no book."),
        (status = 422, description = "More than 2000 uuids, or a uuid longer than 64 bytes."),
    ),
)]
pub(super) async fn add_shelf_books(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<AddBooksRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
    }
    if let Err(resp) = load_for_edit(&state, id, &user).await {
        return resp;
    }
    match db::add_books(&state.pool, id, &req.book_uuids, user.id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e),
    }
}

/// Remove a book from a shelf
///
/// Takes the book off a hand-picked shelf. Removing a book that isn't on the shelf, or an
/// unknown uuid, still succeeds. Only the shelf's owner or an admin can remove books, and
/// the Wishlist shelf can't be edited this way.
#[utoipa::path(
    delete,
    path = "/api/shelves/{id}/books/{uuid}",
    tag = "Shelves",
    params(
        ("id" = i64, Path, description = "The shelf's id."),
        ("uuid" = String, Path, description = "The book's uuid."),
    ),
    responses(
        (status = 204, description = "The book is off the shelf."),
        (status = 403, description = "The shelf is someone else's, or it is the Wishlist shelf."),
        (status = 404, description = "No shelf has that id, or it is another reader's private shelf."),
    ),
)]
pub(super) async fn remove_shelf_book(
    user: AuthUser,
    State(state): State<AppState>,
    Path((id, uuid)): Path<(i64, String)>,
) -> Response {
    if let Err(resp) = load_for_edit(&state, id, &user).await {
        return resp;
    }
    match db::remove_book(&state.pool, id, &uuid).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => map_err(e),
    }
}

/// Preview a smart shelf's rules
///
/// Counts how many books a set of rules would match, out of how many in the library, with
/// a sample of up to 12 of them. Nothing is saved. Rules on your own data, such as rating
/// and read status, are matched against yours.
#[utoipa::path(
    post,
    path = "/api/shelves/preview",
    tag = "Shelves",
    operation_id = "preview_shelf_rule",
    request_body = RulePreviewRequest,
    responses(
        (status = 200, description = "The match count, the library total and a sample.", body = RulePreview),
        (status = 422, description = "More than 50 rules, an operator the field doesn't take, an empty value, or a value that can't be evaluated; the body says which."),
    ),
)]
pub(super) async fn preview_rule(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<RulePreviewRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
    }
    match db::preview_rule(&state.pool, user.id, req.match_mode, &req.rules).await {
        Ok(preview) => Json(preview).into_response(),
        Err(e) => map_err(e),
    }
}

// --- helpers ---------------------------------------------------------------

/// Load a shelf and enforce the view rule (owner, admin, or public). Both an
/// unknown id and a shelf the caller can't see return **404** — existence is
/// deliberately not leaked to non-viewers.
async fn load_for_view(state: &AppState, id: i64, user: &AuthUser) -> Result<Shelf, Response> {
    let shelf = fetch(state, id).await?;
    if db::can_view(&shelf, user.id, user.is_admin) {
        Ok(shelf)
    } else {
        Err((StatusCode::NOT_FOUND, "shelf not found").into_response())
    }
}

/// Load a shelf and enforce the edit rule (owner or admin). A viewer who can see
/// but not edit gets 403; an unknown id gets 404.
async fn load_for_edit(state: &AppState, id: i64, user: &AuthUser) -> Result<Shelf, Response> {
    let shelf = fetch(state, id).await?;
    if db::can_edit(&shelf, user.id, user.is_admin) {
        Ok(shelf)
    } else if db::can_view(&shelf, user.id, user.is_admin) {
        Err((StatusCode::FORBIDDEN, "not your shelf").into_response())
    } else {
        Err((StatusCode::NOT_FOUND, "shelf not found").into_response())
    }
}

async fn fetch(state: &AppState, id: i64) -> Result<Shelf, Response> {
    match db::get_shelf(&state.pool, id).await {
        Ok(Some(shelf)) => Ok(shelf),
        Ok(None) => Err((StatusCode::NOT_FOUND, "shelf not found").into_response()),
        Err(e) => Err(map_err(e)),
    }
}

/// Map a [`ShelfError`] to its HTTP response.
fn map_err(e: ShelfError) -> Response {
    match e {
        ShelfError::NotFound => (StatusCode::NOT_FOUND, "shelf not found").into_response(),
        ShelfError::NameTaken => (
            StatusCode::CONFLICT,
            "a shelf with that name already exists",
        )
            .into_response(),
        ShelfError::BookNotFound => (StatusCode::NOT_FOUND, "book not found").into_response(),
        ShelfError::InvalidRule(msg) => (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response(),
        ShelfError::SystemShelf => {
            (StatusCode::FORBIDDEN, "system shelves cannot be modified").into_response()
        }
        ShelfError::Sqlx(e) => internal("shelf operation", e),
    }
}

#[cfg(test)]
mod tests;
