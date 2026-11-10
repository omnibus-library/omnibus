//! The fake Prowlarr v1 API: `system/status`, `indexerstatus` and `search`, behind the
//! `X-Api-Key` header. A search is answered from the query by [`crate::catalogue`], or
//! empty or failing as the control API says.

use axum::extract::{Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::catalogue::{self, Release};
use crate::downloads::SearchMode;
use crate::{Shared, PROWLARR_API_KEY};

const INDEXER: &str = "Mock Indexer";

/// The Prowlarr routes, behind the API key.
pub fn routes() -> Router<Shared> {
    Router::new()
        .route("/api/v1/system/status", get(status))
        .route("/api/v1/indexerstatus", get(indexer_status))
        .route("/api/v1/search", get(search))
        .route_layer(middleware::from_fn(require_key))
}

/// 401 unless the request carries the mock's API key.
async fn require_key(headers: HeaderMap, request: Request, next: Next) -> Response {
    let key = headers.get("x-api-key").and_then(|v| v.to_str().ok());
    if key == Some(PROWLARR_API_KEY) {
        next.run(request).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

async fn status() -> Json<Value> {
    Json(json!({"appName": "Prowlarr", "version": "1.30.2"}))
}

async fn indexer_status() -> Json<Value> {
    Json(json!([]))
}

#[derive(Deserialize)]
struct SearchQuery {
    #[serde(default)]
    query: String,
    #[serde(default)]
    categories: String,
}

async fn search(State(mock): State<Shared>, Query(q): Query<SearchQuery>) -> Response {
    let mut store = mock.store();
    let kind = catalogue::kind_for_category(&q.categories);
    let kind = match (store.search, kind) {
        (SearchMode::Fail, _) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        (SearchMode::Empty, _) | (_, None) => return Json(json!([])).into_response(),
        (SearchMode::Results, Some(kind)) => kind,
    };
    let made = catalogue::releases(&q.query, kind, || store.mint());
    let rows: Vec<Value> = made.iter().map(|r| row(r, &mock.origin)).collect();
    for release in made {
        store.remember(release);
    }
    Json(rows).into_response()
}

/// One release as Prowlarr's search JSON has it.
fn row(release: &Release, origin: &str) -> Value {
    let torrent = release.protocol == omnibus_shared::ReleaseProtocol::Torrent;
    let mut row = json!({
        "guid": release.id,
        "title": release.title,
        "size": release.format.size_bytes(),
        "seeders": torrent.then_some(25),
        "protocol": release.protocol.as_str(),
        "indexer": INDEXER,
        "categories": [{"id": release.category()}],
        "files": 1,
    });
    let link_field = if torrent { "magnetUrl" } else { "downloadUrl" };
    row[link_field] = release.link(origin).into();
    row
}

#[cfg(test)]
mod tests;
