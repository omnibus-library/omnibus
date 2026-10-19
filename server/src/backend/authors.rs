//! `/api/authors/*` handlers.
//!
//! Cookie-gated reads that return the authors index, per-author detail, and
//! the caller's own progress through each author.
//! Detail reads also enqueue a background `ResolveAuthorPhoto` task when
//! the author has no cached photo yet.

use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, worker::Task};
use omnibus_shared::{AuthorDetail, AuthorReading, AuthorSummary};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Get an author
///
/// One author and all their books. `reading` holds your own status and position on each
/// of those books you have opened or marked. Opening an author with no photo yet starts a
/// search for one in the background.
#[utoipa::path(
    get,
    path = "/api/authors/{id}",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The author's id.")),
    responses(
        (status = 200, description = "The author.", body = AuthorDetail),
        (status = 404, description = "No author has that id."),
    ),
)]
pub(super) async fn get_author_by_id(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::get_author(&state.pool, id).await {
        Ok(Some(mut author)) => {
            match db::book_reading(&state.pool, user.id, &db::book_uuids(&author.books)).await {
                Ok(reading) => author.reading = reading,
                Err(e) => return internal("author book reading", e),
            }
            // Queue a background resolution when the author has no
            // `author_photos` row yet so first-time visits trigger Open
            // Library resolution. A subsequent visit picks up the resolved
            // photo (or the `letter` negative-cache marker).
            if !author.has_photo {
                match db::author_photo_status(&state.pool, id).await {
                    Ok(None) => {
                        state
                            .worker
                            .post(Task::ResolveAuthorPhoto { author_id: id });
                    }
                    Ok(Some(_)) => {}
                    Err(e) => {
                        // Don't fail the read — just skip the queue and log.
                        tracing::warn!(
                            author_id = id,
                            error = %e,
                            "author_photo_status check failed; skipping autoresolution"
                        );
                    }
                }
            }
            Json(author).into_response()
        }
        Ok(None) => axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal("read author", error),
    }
}

/// List authors
///
/// Every author with a book in the library, surname first, each with a book count, an
/// accent color and whether a photo is cached. Stops at 10,000 authors.
#[utoipa::path(
    get,
    path = "/api/authors",
    tag = "Discovery",
    responses((status = 200, description = "The authors.", body = Vec<AuthorSummary>)),
)]
pub(super) async fn get_authors(_user: AuthUser, State(state): State<AppState>) -> Response {
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(e) => return internal("read settings", e),
    };
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    match db::list_authors(&state.pool, &paths).await {
        Ok(authors) => Json(authors).into_response(),
        Err(e) => internal("list authors", e),
    }
}

/// List your progress through each author
///
/// For each author whose books you have opened or marked: how many you have finished, how
/// many you are reading, and when you last read one. Authors you haven't started are left
/// out.
#[utoipa::path(
    get,
    path = "/api/authors/reading",
    tag = "Discovery",
    responses((status = 200, description = "Your progress, one row per author.", body = Vec<AuthorReading>)),
)]
pub(super) async fn get_author_reading(user: AuthUser, State(state): State<AppState>) -> Response {
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(e) => return internal("read settings", e),
    };
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    match db::author_reading(&state.pool, user.id, &paths).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => internal("author reading", e),
    }
}

#[cfg(test)]
mod tests;
