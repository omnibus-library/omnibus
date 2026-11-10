//! The fake qBittorrent Web API v2: login, add by magnet, list, files and delete. Any login
//! is accepted and no cookie is checked. A torrent is the release id a magnet names, and its
//! files appear under `mock-<id>/` once the download finishes.

use std::time::Instant;

use axum::extract::{Query, State};
use axum::http::{header::SET_COOKIE, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use omnibus_shared::ReleaseProtocol;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::catalogue::magnet_hash;
use crate::downloads::{Client, Download, Outcome};
use crate::Shared;

pub fn routes() -> Router<Shared> {
    Router::new()
        .route("/api/v2/auth/login", post(login))
        .route("/api/v2/app/version", get(version))
        .route("/api/v2/torrents/add", post(add))
        .route("/api/v2/torrents/info", get(info))
        .route("/api/v2/torrents/files", get(files))
        .route("/api/v2/torrents/delete", post(delete))
}

async fn login() -> impl IntoResponse {
    ([(SET_COOKIE, "SID=mock; path=/")], "Ok.")
}

async fn version() -> &'static str {
    "v5.0.0"
}

#[derive(Deserialize)]
struct AddForm {
    urls: String,
}

/// 200 `Ok.` when the magnet names a torrent release the mock offered, else 200 `Fails.`.
async fn add(State(mock): State<Shared>, Form(form): Form<AddForm>) -> &'static str {
    let mut store = mock.store();
    let release = magnet_hash(&form.urls)
        .and_then(|hash| store.release(&hash).cloned())
        .filter(|r| r.protocol == ReleaseProtocol::Torrent);
    let Some(release) = release else {
        return "Fails.";
    };
    let (id, folder) = (release.id.clone(), format!("mock-{}", release.id));
    store.add(Client::Qbittorrent, id, release, folder, Instant::now());
    "Ok."
}

#[derive(Deserialize)]
struct InfoQuery {
    /// Pipe-separated; absent lists every torrent.
    hashes: Option<String>,
}

async fn info(State(mock): State<Shared>, Query(q): Query<InfoQuery>) -> Json<Vec<Value>> {
    let mut store = mock.store();
    store.refresh(Instant::now());
    let root = store.root().to_string_lossy().into_owned();
    let wanted = |d: &Download| {
        q.hashes
            .as_deref()
            .is_none_or(|hashes| hashes.split('|').any(|h| h == d.id))
    };
    let rows = store
        .of(Client::Qbittorrent)
        .filter(|d| wanted(d))
        .map(|d| {
            json!({
                "hash": d.id,
                "progress": d.progress(),
                "state": state(d),
                "save_path": root,
                "eta": d.eta(),
                "tags": "",
                "added_on": d.added,
            })
        })
        .collect();
    Json(rows)
}

/// qBittorrent's word for where a download is.
fn state(d: &Download) -> &'static str {
    match (d.done, d.outcome) {
        (true, _) => "stalledUP",
        (_, Outcome::Fail) => "error",
        (_, Outcome::Stall) => "stalledDL",
        _ => "downloading",
    }
}

#[derive(Deserialize)]
struct FilesQuery {
    hash: String,
}

async fn files(State(mock): State<Shared>, Query(q): Query<FilesQuery>) -> Response {
    let mut store = mock.store();
    store.refresh(Instant::now());
    let Some(download) = store.find(Client::Qbittorrent, &q.hash) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let listed: Vec<Value> = store
        .files(download)
        .into_iter()
        .map(|(name, size)| json!({"name": format!("{}/{name}", download.folder), "size": size}))
        .collect();
    Json(listed).into_response()
}

#[derive(Deserialize)]
struct DeleteForm {
    /// Pipe-separated.
    hashes: String,
    #[serde(rename = "deleteFiles")]
    delete_files: String,
}

async fn delete(State(mock): State<Shared>, Form(form): Form<DeleteForm>) {
    let mut store = mock.store();
    for hash in form.hashes.split('|') {
        store.remove(Client::Qbittorrent, hash, form.delete_files == "true");
    }
}

#[cfg(test)]
mod tests;
