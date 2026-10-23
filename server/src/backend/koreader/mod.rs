//! The KOReader plugin's device routes (`/koreader/v1/*`), mounted outside the
//! `/api/*` auth gate: each route authenticates through [`extractor::KoreaderDevice`].
//! Like `/kobo/*` they are not part of the REST contract, so they are plain
//! routes with DTOs local to the module. [`library`] lists and serves the synced
//! shelves' books; the Settings plugin download lives with the device routes.

use axum::{routing::get, Router};

use super::AppState;

mod extractor;
mod library;
#[cfg(test)]
mod tests;

/// Build the KOReader device router.
pub fn koreader_router(state: AppState) -> Router {
    Router::new()
        .route("/koreader/v1/library", get(library::library))
        .route("/koreader/v1/books/{uuid}/file", get(library::file))
        .with_state(state)
}
