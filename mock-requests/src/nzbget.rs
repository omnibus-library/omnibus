//! The fake NZBGet JSON-RPC at `/jsonrpc`, with any login accepted. Jobs are named
//! `omnibus-<40 hex>.nzb` by the server, checked as such before the name becomes a folder.
//! A job is in `listgroups` until it ends, then in `history` as `SUCCESS` or `FAILURE`.

use std::time::Instant;

use axum::extract::State;
use axum::routing::post;
use axum::Json;
use axum::Router;
use base64::engine::{general_purpose::STANDARD, Engine as _};
use omnibus_shared::DownloadClientKind;
use serde_json::{json, Value};

use crate::downloads::{Download, Store};
use crate::Shared;

/// The size every mock job reports, so the bar can be worked out from what is left.
const JOB_MB: f64 = 100.0;

const KIND: DownloadClientKind = DownloadClientKind::Nzbget;

/// The JSON-RPC route.
pub fn routes() -> Router<Shared> {
    Router::new().route("/jsonrpc", post(rpc))
}

async fn rpc(State(mock): State<Shared>, Json(call): Json<Value>) -> Json<Value> {
    let params = &call["params"];
    let mut store = mock.fresh_store();
    let outcome = match call["method"].as_str() {
        Some("version") => Ok(json!("21.1")),
        Some("listgroups") => Ok(Value::Array(groups(&store))),
        Some("history") => Ok(Value::Array(history(&store))),
        Some("append") => append(&mut store, params),
        Some("editqueue") => Ok(json!(edit(&mut store, params))),
        other => Err(format!("unknown method {}", other.unwrap_or_default())),
    };
    Json(match outcome {
        Ok(result) => json!({"version": "1.1", "id": call["id"], "result": result}),
        Err(message) => json!({
            "version": "1.1",
            "id": call["id"],
            "error": {"name": "JSONRPCError", "code": 1, "message": message},
        }),
    })
}

fn dir(store: &Store, d: &Download) -> String {
    store.root().join(&d.folder).to_string_lossy().into_owned()
}

fn groups(store: &Store) -> Vec<Value> {
    store
        .of(KIND)
        .filter(|d| !d.ended())
        .map(|d| {
            json!({
                "NZBID": d.num,
                "NZBName": d.id,
                "Status": "DOWNLOADING",
                "FileSizeMB": JOB_MB,
                "RemainingSizeMB": JOB_MB * (1.0 - d.progress()),
                "FinalDir": "",
                "DestDir": dir(store, d),
            })
        })
        .collect()
}

fn history(store: &Store) -> Vec<Value> {
    store
        .of(KIND)
        .filter(|d| d.ended())
        .map(|d| {
            json!({
                "NZBID": d.num,
                "Name": d.id,
                "Status": if d.done { "SUCCESS/ALL" } else { "FAILURE/UNPACK" },
                "FinalDir": dir(store, d),
                "DestDir": dir(store, d),
            })
        })
        .collect()
}

/// `append [name, base64 content, ...]`: the new job's NZBID, or why it was refused.
fn append(store: &mut Store, params: &Value) -> Result<Value, String> {
    let name = params[0].as_str().unwrap_or_default();
    let name = name.strip_suffix(".nzb").unwrap_or(name);
    let nzb = STANDARD
        .decode(params[1].as_str().unwrap_or_default())
        .map_err(|_| "the NZB is not base64".to_string())?;
    let num = store.add_usenet(KIND, name, &nzb, Instant::now())?;
    Ok(json!(num))
}

/// `editqueue [command, "", [ids]]`: whether the command was one the mock knows.
fn edit(store: &mut Store, params: &Value) -> bool {
    let command = params[0].as_str().unwrap_or_default();
    let known = [
        "GroupDelete",
        "GroupFinalDelete",
        "HistoryDelete",
        "HistoryFinalDelete",
    ];
    if !known.contains(&command) {
        return false;
    }
    let delete_files = command.ends_with("FinalDelete");
    for num in params[2]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
    {
        store.remove_num(KIND, num, delete_files);
    }
    true
}

#[cfg(test)]
mod tests;
