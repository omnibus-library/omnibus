//! The `/_mock` control API: steer what the fakes report and read what they hold. This is
//! how a developer or a tour reaches the request states that need something to go wrong.

use std::time::Instant;

use axum::extract::State;
use axum::routing::{get, put};
use axum::{Json, Router};
use omnibus_shared::DownloadClientKind;
use serde::{Deserialize, Serialize};

use crate::downloads::{Outcome, SearchMode};
use crate::Shared;

/// The `/_mock` routes.
pub fn routes() -> Router<Shared> {
    Router::new()
        .route("/_mock", get(view))
        .route("/_mock/search", put(set_search))
        .route("/_mock/downloads", put(set_downloads))
}

#[derive(Serialize)]
struct View {
    search: SearchMode,
    outcome: Outcome,
    secs: u64,
    downloads: Vec<Row>,
}

#[derive(Serialize)]
struct Row {
    id: String,
    client: DownloadClientKind,
    progress: f64,
    outcome: Outcome,
}

#[derive(Deserialize)]
struct SearchBody {
    mode: SearchMode,
}

/// A typo'd key is refused rather than silently doing nothing.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DownloadsBody {
    outcome: Option<Outcome>,
    secs: Option<u64>,
}

async fn view(State(mock): State<Shared>) -> Json<View> {
    let store = mock.fresh_store();
    Json(View {
        search: store.search,
        outcome: store.outcome,
        secs: store.secs,
        downloads: store
            .all()
            .iter()
            .map(|d| Row {
                id: d.id.clone(),
                client: d.client,
                progress: d.progress(),
                outcome: d.outcome,
            })
            .collect(),
    })
}

async fn set_search(State(mock): State<Shared>, Json(body): Json<SearchBody>) -> Json<View> {
    mock.store().search = body.mode;
    view(State(mock)).await
}

async fn set_downloads(State(mock): State<Shared>, Json(body): Json<DownloadsBody>) -> Json<View> {
    mock.store().set(body.outcome, body.secs, Instant::now());
    view(State(mock)).await
}

#[cfg(test)]
mod tests;
