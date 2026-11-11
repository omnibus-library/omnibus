//! The fake SABnzbd API at `/api`, as JSON whatever `output` asks for and with any API key
//! accepted. Jobs are named `omnibus-<40 hex>` by the server, checked as such before the
//! name becomes a folder. A job is in the queue until it finishes, then in history as
//! `Completed`; a failing one goes straight to history as `Failed`.

use std::collections::HashMap;
use std::time::Instant;

use axum::extract::{Multipart, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use omnibus_shared::DownloadClientKind;
use serde_json::{json, Value};

use crate::downloads::{Download, Store};
use crate::Shared;

const NZO_PREFIX: &str = "SABnzbd_nzo_";

const KIND: DownloadClientKind = DownloadClientKind::Sabnzbd;

type Params = Query<HashMap<String, String>>;

/// The one `/api` route, which reads and adds by `mode`.
pub fn routes() -> Router<Shared> {
    Router::new().route("/api", get(read).post(addfile))
}

/// `mode=queue`, `mode=history`, and deleting from either.
async fn read(State(mock): State<Shared>, Query(params): Params) -> Json<Value> {
    let mut store = mock.fresh_store();
    let param = |name: &str| params.get(name).map(String::as_str);
    let mode = param("mode").unwrap_or_default();
    if param("name") == Some("delete") {
        remove(&mut store, param("value"), param("del_files") == Some("1"));
        return Json(json!({"status": true}));
    }
    match mode {
        "queue" => Json(json!({"queue": {"slots": queue(&store)}})),
        "history" => Json(json!({"history": {"slots": history(&store)}})),
        other => Json(json!({"status": false, "error": format!("unknown mode {other}")})),
    }
}

fn queue(store: &Store) -> Vec<Value> {
    store
        .of(KIND)
        .filter(|d| !d.ended())
        .map(|d| {
            json!({
                "nzo_id": nzo(d),
                "filename": d.id,
                "status": "Downloading",
                // SABnzbd sends the percentage as a string.
                "percentage": format!("{:.0}", d.progress() * 100.0),
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
                "nzo_id": nzo(d),
                "name": d.id,
                "status": if d.done { "Completed" } else { "Failed" },
                "storage": store.root().join(&d.folder).to_string_lossy(),
            })
        })
        .collect()
}

fn nzo(d: &Download) -> String {
    format!("{NZO_PREFIX}{}", d.num)
}

fn remove(store: &mut Store, nzo_id: Option<&str>, delete_files: bool) {
    let num = nzo_id
        .and_then(|v| v.strip_prefix(NZO_PREFIX))
        .and_then(|n| n.parse::<u64>().ok());
    if let Some(num) = num {
        store.remove_num(KIND, num, delete_files);
    }
}

/// `mode=addfile`: the NZB is the multipart part `name`, the job's name is `nzbname`.
async fn addfile(
    State(mock): State<Shared>,
    Query(params): Params,
    mut upload: Multipart,
) -> Json<Value> {
    let name = params
        .get("nzbname")
        .map(String::as_str)
        .unwrap_or_default();
    let mut nzb = Vec::new();
    while let Ok(Some(field)) = upload.next_field().await {
        if field.name() == Some("name") {
            nzb = field.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
        }
    }
    let added = mock.store().add_usenet(KIND, name, &nzb, Instant::now());
    Json(match added {
        Ok(num) => json!({"status": true, "nzo_ids": [format!("{NZO_PREFIX}{num}")]}),
        Err(why) => json!({"status": false, "error": why.to_string()}),
    })
}

#[cfg(test)]
mod tests;
