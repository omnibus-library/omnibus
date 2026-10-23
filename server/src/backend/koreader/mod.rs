//! The KOReader plugin's device routes (`/koreader/v1/*`), mounted outside the
//! `/api/*` auth gate: each route authenticates through [`extractor::KoreaderDevice`].
//! Like `/kobo/*` they are not part of the REST contract, so they are plain
//! routes with DTOs local to the module. [`library`] lists and serves the synced
//! shelves' books; [`state`] syncs a book's reading position and status; [`annotations`]
//! syncs its highlights and notes; [`report`] stores each sync's outcome for Settings, and
//! [`plugin`] builds the plugin zip the Settings download serves.

use axum::{
    routing::{get, post},
    Router,
};

use super::AppState;

mod annotations;
mod extractor;
mod library;
pub(super) mod plugin;
mod report;
mod state;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

/// Build the KOReader device router.
pub fn koreader_router(state: AppState) -> Router {
    Router::new()
        .route("/koreader/v1/library", get(library::library))
        .route("/koreader/v1/books/{uuid}/file", get(library::file))
        .route("/koreader/v1/books/{uuid}/cover", get(library::cover))
        .route(
            "/koreader/v1/books/{uuid}/state",
            get(state::get_state).put(state::put_state),
        )
        .route(
            "/koreader/v1/books/{uuid}/annotations",
            get(annotations::get_annotations).post(annotations::post_annotations),
        )
        .route("/koreader/v1/sync-report", post(report::sync_report))
        .with_state(state)
}
