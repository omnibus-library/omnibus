//! The `/_mock` control API: steer what the fakes report and read what they hold. This is
//! how a developer or a tour reaches the request states that need something to go wrong,
//! reads what the fake ntfy was sent, and makes its next publishes fail.

use std::num::NonZeroU32;
use std::time::Instant;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use omnibus_shared::DownloadClientKind;
use serde::{Deserialize, Deserializer, Serialize};

use crate::downloads::{Outcome, SearchMode};
use crate::ntfy::{Failure, Forcing, Published};
use crate::Shared;

/// The `/_mock` routes.
pub fn routes() -> Router<Shared> {
    Router::new()
        .route("/_mock", get(view))
        .route("/_mock/search", put(set_search))
        .route("/_mock/downloads", put(set_downloads))
        .route(
            "/_mock/ntfy",
            get(ntfy_view).put(set_ntfy).delete(clear_ntfy),
        )
}

#[derive(Serialize)]
struct View {
    search: SearchMode,
    outcome: Outcome,
    secs: u64,
    downloads: Vec<Row>,
    ntfy: NtfySummary,
}

#[derive(Serialize)]
struct Row {
    id: String,
    client: DownloadClientKind,
    progress: f64,
    outcome: Outcome,
}

/// The fake ntfy in the overview: what publishes are answered with and how many are kept.
#[derive(Serialize)]
struct NtfySummary {
    #[serde(flatten)]
    forcing: Forcing,
    received: usize,
}

/// `/_mock/ntfy`: what publishes are answered with and every one kept, oldest first.
#[derive(Serialize)]
struct NtfyView {
    #[serde(flatten)]
    forcing: Forcing,
    messages: Vec<Published>,
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

/// `PUT /_mock/ntfy`, which replaces the whole forcing state. `fail` must be given, as a
/// failure or as null, so a body that would be silently ignored is refused instead.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NtfyBody {
    #[serde(default, deserialize_with = "given")]
    fail: Option<Option<Failure>>,
    times: Option<NonZeroU32>,
    retry_after: Option<u32>,
}

/// Tells a `fail` given as null (`Some(None)`) from one left out (`None`).
fn given<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<Failure>>, D::Error> {
    Option::<Failure>::deserialize(d).map(Some)
}

/// Why a `PUT /_mock/ntfy` body can't be used.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
enum NtfyBodyError {
    #[error("fail is required: a failure to force, or null to answer normally")]
    NoFail,
    #[error("times and retry_after need a fail; send {{\"fail\": null}} alone to answer normally")]
    WithoutFail,
}

impl IntoResponse for NtfyBodyError {
    fn into_response(self) -> Response {
        (StatusCode::UNPROCESSABLE_ENTITY, self.to_string()).into_response()
    }
}

impl TryFrom<NtfyBody> for Forcing {
    type Error = NtfyBodyError;

    fn try_from(body: NtfyBody) -> Result<Self, Self::Error> {
        match body.fail.ok_or(NtfyBodyError::NoFail)? {
            Some(fail) => Ok(Forcing {
                fail: Some(fail),
                times: body.times,
                retry_after: body.retry_after,
            }),
            None if body.times.is_some() || body.retry_after.is_some() => {
                Err(NtfyBodyError::WithoutFail)
            }
            None => Ok(Forcing::default()),
        }
    }
}

async fn view(State(mock): State<Shared>) -> Json<View> {
    let ntfy = {
        let inbox = mock.ntfy();
        NtfySummary {
            forcing: inbox.forcing(),
            received: inbox.received().len(),
        }
    };
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
        ntfy,
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

async fn ntfy_view(State(mock): State<Shared>) -> Json<NtfyView> {
    let inbox = mock.ntfy();
    Json(NtfyView {
        forcing: inbox.forcing(),
        messages: inbox.received().iter().cloned().collect(),
    })
}

async fn set_ntfy(
    State(mock): State<Shared>,
    Json(body): Json<NtfyBody>,
) -> Result<Json<NtfyView>, NtfyBodyError> {
    mock.ntfy().force(Forcing::try_from(body)?);
    Ok(ntfy_view(State(mock)).await)
}

async fn clear_ntfy(State(mock): State<Shared>) -> Json<NtfyView> {
    mock.ntfy().clear();
    ntfy_view(State(mock)).await
}

#[cfg(test)]
mod tests;
