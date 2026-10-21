//! Series detail + index fetchers (`get_series`, `list_series`) and the
//! reader's progress through each series (`list_series_reading`).
//!
//! Thin one-call wrappers over `/api/series` (mobile REST) and the
//! corresponding `rpc_*` server functions (web/SSR).

use omnibus_shared::{SeriesDetail, SeriesReading, SeriesSummary};

#[cfg(not(feature = "mobile"))]
use super::note_server_fn_err;
use super::DataError;
#[cfg(feature = "mobile")]
use super::{drain_error, http_client, note_status, with_bearer};

/// GET `/api/series/{id}` — fetch one series detail, `Ok(None)` on 404.
#[cfg(feature = "mobile")]
pub async fn get_series(server_url: &str, id: i64) -> Result<Option<SeriesDetail>, DataError> {
    let url = server_url.to_string();
    crate::offline::cache::read_through(crate::offline::cache::keys::series(id), async move {
        get_series_online(&url, id).await
    })
    .await
}

/// Native HTTP transport for [`get_series`].
#[cfg(feature = "mobile")]
pub(crate) async fn get_series_online(
    server_url: &str,
    id: i64,
) -> Result<Option<SeriesDetail>, DataError> {
    let url = format!("{server_url}/api/series/{id}");
    let response = with_bearer(http_client().get(&url)).send().await?;
    let status = note_status(response.status());
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(Some(response.json::<SeriesDetail>().await?))
}

/// GET `/api/series` — fetch the full series index for browse / autocomplete.
#[cfg(feature = "mobile")]
pub async fn list_series(server_url: &str) -> Result<Vec<SeriesSummary>, DataError> {
    let url = server_url.to_string();
    crate::offline::cache::read_through(crate::offline::cache::keys::series_index(), async move {
        list_series_online(&url).await
    })
    .await
}

/// Native HTTP transport for [`list_series`].
#[cfg(feature = "mobile")]
pub(crate) async fn list_series_online(server_url: &str) -> Result<Vec<SeriesSummary>, DataError> {
    let url = format!("{server_url}/api/series");
    let response = with_bearer(http_client().get(&url)).send().await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<Vec<SeriesSummary>>().await?)
}

/// GET `/api/series/reading` — the caller's progress through each series.
#[cfg(feature = "mobile")]
pub async fn list_series_reading(server_url: &str) -> Result<Vec<SeriesReading>, DataError> {
    let url = server_url.to_string();
    crate::offline::cache::read_through(crate::offline::cache::keys::series_reading(), async move {
        list_series_reading_online(&url).await
    })
    .await
}

/// Native HTTP transport for [`list_series_reading`].
#[cfg(feature = "mobile")]
pub(crate) async fn list_series_reading_online(
    server_url: &str,
) -> Result<Vec<SeriesReading>, DataError> {
    let url = format!("{server_url}/api/series/reading");
    let response = with_bearer(http_client().get(&url)).send().await?;
    let status = note_status(response.status());
    if !status.is_success() {
        return Err(drain_error(response, status).await);
    }
    Ok(response.json::<Vec<SeriesReading>>().await?)
}

/// Web/SSR `get_series` — server-function wrapper that proxies to `rpc_get_series`.
#[cfg(not(feature = "mobile"))]
pub async fn get_series(_server_url: &str, id: i64) -> Result<Option<SeriesDetail>, DataError> {
    crate::rpc::rpc_get_series(id)
        .await
        .map_err(note_server_fn_err)
}

/// Web/SSR `list_series` — server-function wrapper that proxies to `rpc_list_series`.
#[cfg(not(feature = "mobile"))]
pub async fn list_series(_server_url: &str) -> Result<Vec<SeriesSummary>, DataError> {
    crate::rpc::rpc_list_series()
        .await
        .map_err(note_server_fn_err)
}

/// Web/SSR `list_series_reading` — proxies to `rpc_list_series_reading`.
#[cfg(not(feature = "mobile"))]
pub async fn list_series_reading(_server_url: &str) -> Result<Vec<SeriesReading>, DataError> {
    crate::rpc::rpc_list_series_reading()
        .await
        .map_err(note_server_fn_err)
}
