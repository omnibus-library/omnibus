//! The fake SABnzbd API at `/api`, as JSON whatever `output` asks for and with any API key
//! accepted. Jobs are named `omnibus-<40 hex>` by the server, checked as such before the
//! name becomes a folder. A job is in the queue until it finishes, then in history as
//! `Completed`; a failing one goes straight to history as `Failed`.

use std::collections::HashMap;
use std::time::Instant;

use axum::extract::{Multipart, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use omnibus_shared::ReleaseProtocol;
use serde_json::{json, Value};

use crate::downloads::{Client, Download, Outcome, Store};
use crate::nzb::{job_name_ok, release_id};
use crate::Shared;

const NZO_PREFIX: &str = "SABnzbd_nzo_";

type Params = Query<HashMap<String, String>>;

pub fn routes() -> Router<Shared> {
    Router::new().route("/api", get(read).post(addfile))
}

/// `mode=queue`, `mode=history`, and deleting from either.
async fn read(State(mock): State<Shared>, Query(params): Params) -> Json<Value> {
    let mut store = mock.store();
    store.refresh(Instant::now());
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

/// A job that has failed or finished is in history; the rest are queued.
fn finished(d: &Download) -> bool {
    d.done || d.outcome == Outcome::Fail
}

fn queue(store: &Store) -> Vec<Value> {
    store
        .of(Client::Sabnzbd)
        .filter(|d| !finished(d))
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
        .of(Client::Sabnzbd)
        .filter(|d| finished(d))
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
    let id = num.and_then(|n| {
        store
            .of(Client::Sabnzbd)
            .find(|d| d.num == n)
            .map(|d| d.id.clone())
    });
    if let Some(id) = id {
        store.remove(Client::Sabnzbd, &id, delete_files);
    }
}

/// `mode=addfile`: the NZB is the multipart part `name`, the job's name is `nzbname`.
async fn addfile(
    State(mock): State<Shared>,
    Query(params): Params,
    mut upload: Multipart,
) -> Json<Value> {
    let refused = |why: &str| Json(json!({"status": false, "error": why}));
    let name = params
        .get("nzbname")
        .map(String::as_str)
        .unwrap_or_default();
    if !job_name_ok(name) {
        return refused("the job name is not one Omnibus gives");
    }
    let mut nzb = Vec::new();
    while let Ok(Some(field)) = upload.next_field().await {
        if field.name() == Some("name") {
            nzb = field.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
        }
    }
    let mut store = mock.store();
    let release = release_id(&nzb)
        .and_then(|id| store.release(&id).cloned())
        .filter(|r| r.protocol == ReleaseProtocol::Usenet);
    let Some(release) = release else {
        return refused("this NZB is not one the mock offered");
    };
    let num = store.add(
        Client::Sabnzbd,
        name.to_string(),
        release,
        name.to_string(),
        Instant::now(),
    );
    Json(json!({"status": true, "nzo_ids": [format!("{NZO_PREFIX}{num}")]}))
}

#[cfg(test)]
mod tests;
