//! The `/_mock` control API: steer what the fakes report and read what they hold. This is
//! how a developer or a tour reaches the request states that need something to go wrong.

use axum::extract::State;
use axum::routing::{get, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::downloads::SearchMode;
use crate::Shared;

pub fn routes() -> Router<Shared> {
    Router::new()
        .route("/_mock", get(view))
        .route("/_mock/search", put(set_search))
}

#[derive(Serialize)]
struct View {
    search: SearchMode,
}

#[derive(Deserialize)]
struct SearchBody {
    mode: SearchMode,
}

async fn view(State(mock): State<Shared>) -> Json<View> {
    Json(View {
        search: mock.store().search,
    })
}

async fn set_search(State(mock): State<Shared>, Json(body): Json<SearchBody>) -> Json<View> {
    mock.store().search = body.mode;
    view(State(mock)).await
}

#[cfg(test)]
mod tests;
