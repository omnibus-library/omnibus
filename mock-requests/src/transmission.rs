//! The fake Transmission RPC at `/transmission/rpc`. Like the real one it answers 409 with a
//! session id until a call carries it, which the server's client handles. Any login is
//! accepted. A torrent is the release id a magnet names, and its files appear under
//! `mock-<id>/` once the download finishes.

use std::time::Instant;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use omnibus_shared::DownloadClientKind;
use serde_json::{json, Value};

use crate::downloads::{Download, Outcome, Store};
use crate::Shared;

const SESSION_HEADER: &str = "x-transmission-session-id";
const SESSION_ID: &str = "mock-session";

const KIND: DownloadClientKind = DownloadClientKind::Transmission;

/// Transmission's status number for a torrent that is downloading.
const DOWNLOADING: u8 = 4;

/// Transmission's status number for a torrent that finished and is seeding.
const SEEDING: u8 = 6;

/// `error` value for a local error, the one the server reads as a failed download.
const LOCAL_ERROR: i64 = 3;

/// The RPC route.
pub fn routes() -> Router<Shared> {
    Router::new().route("/transmission/rpc", post(rpc))
}

async fn rpc(State(mock): State<Shared>, headers: HeaderMap, Json(call): Json<Value>) -> Response {
    let known = headers.get(SESSION_HEADER).is_some_and(|v| v == SESSION_ID);
    if !known {
        return (StatusCode::CONFLICT, [(SESSION_HEADER, SESSION_ID)]).into_response();
    }
    let args = &call["arguments"];
    let mut store = mock.fresh_store();
    let reply = match call["method"].as_str() {
        Some("session-get") => success(json!({})),
        Some("torrent-add") => add(&mut store, args),
        Some("torrent-get") => get(&store, args),
        Some("torrent-remove") => remove(&mut store, args),
        _ => json!({"result": "method not recognized"}),
    };
    Json(reply).into_response()
}

fn success(arguments: Value) -> Value {
    json!({"result": "success", "arguments": arguments})
}

fn add(store: &mut Store, args: &Value) -> Value {
    let id = args["filename"]
        .as_str()
        .and_then(|magnet| store.add_torrent(KIND, magnet, Instant::now()));
    match id {
        Some(id) => success(json!({"torrent-added": {"hashString": id}})),
        None => json!({"result": "invalid or corrupt torrent file"}),
    }
}

/// The torrents `ids` names, or all of them when it names none.
fn get(store: &Store, args: &Value) -> Value {
    let ids = args["ids"].as_array();
    let wants_files = args["fields"]
        .as_array()
        .is_some_and(|f| f.iter().any(|f| f == "files"));
    let torrents: Vec<Value> = store
        .of(KIND)
        .filter(|d| ids.is_none_or(|ids| ids.iter().any(|id| id == d.id.as_str())))
        .map(|d| torrent(store, d, wants_files))
        .collect();
    success(json!({"torrents": torrents}))
}

fn torrent(store: &Store, d: &Download, with_files: bool) -> Value {
    let (status, error) = match (d.done, d.outcome) {
        (true, _) => (SEEDING, 0),
        (_, Outcome::Fail) => (DOWNLOADING, LOCAL_ERROR),
        _ => (DOWNLOADING, 0),
    };
    // Transmission sends -1 for "unknown" and for a torrent that is no longer downloading.
    let eta = d.eta(store.secs).unwrap_or(-1);
    let mut row = json!({
        "hashString": d.id,
        "status": status,
        "error": error,
        "percentDone": d.progress(),
        "downloadDir": store.root().to_string_lossy(),
        "eta": eta,
        "addedDate": d.added,
    });
    if with_files {
        row["files"] = store
            .files(d)
            .into_iter()
            .map(|(name, length)| json!({"name": format!("{}/{name}", d.folder), "length": length}))
            .collect();
    }
    row
}

fn remove(store: &mut Store, args: &Value) -> Value {
    let delete_files = args["delete-local-data"].as_bool().unwrap_or(false);
    for id in args["ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        store.remove(KIND, id, delete_files);
    }
    success(json!({}))
}

#[cfg(test)]
mod tests;
