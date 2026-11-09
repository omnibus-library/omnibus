//! Transmission through its JSON RPC at `/transmission/rpc`. Transmission guards the RPC with
//! a session id: a call without the current one is answered 409 carrying it, so each call is
//! sent, and sent once more with the id it is handed. A login is sent as Basic auth only when
//! a username is set. A release is fetched here and uploaded, as for qBittorrent; the
//! category goes in as a label. Transmission's status numbers are reported in qBittorrent's
//! state words, which the poller and importer read.
// shortcut: one session-id round trip per call; keep the id between calls if the poller's
// cadence ever makes it matter.

use base64::engine::{general_purpose::STANDARD, Engine as _};
use reqwest::header::HeaderValue;
use reqwest::{Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::requests::{check_status, http_client, ConnectionError, REQUEST_TIMEOUT};

use super::release::{fetch_torrent, rejected, Release};
use super::{infohash, ClientFile, DownloadClient, Prepared, TorrentStatus};

const SERVICE: &str = "Transmission";
const SESSION_ID: &str = "x-transmission-session-id";

/// A Transmission instance and the login to reach it. No `Debug`: it holds the password.
pub struct Transmission {
    http: reqwest::Client,
    base: String,
    username: String,
    password: String,
    timeout: std::time::Duration,
}

/// The fields of a `torrent-get` row that `status` asks for.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Torrent {
    hash_string: String,
    status: u8,
    #[serde(default)]
    error: i64,
    percent_done: f64,
    download_dir: String,
    eta: Option<i64>,
    added_date: Option<i64>,
}

#[derive(serde::Deserialize)]
struct Torrents<T> {
    torrents: Vec<T>,
}

/// The fields of a `torrent-get` row that `files` asks for.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TorrentFiles {
    hash_string: String,
    files: Vec<File>,
}

#[derive(serde::Deserialize)]
struct File {
    name: String,
    length: u64,
}

impl Transmission {
    /// A client for the instance at `base_url`, such as `http://transmission:9091`.
    pub fn new(base_url: &str, username: &str, password: &str) -> Result<Self, ConnectionError> {
        Ok(Self {
            http: http_client()?,
            base: base_url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
            timeout: REQUEST_TIMEOUT,
        })
    }

    async fn post(
        &self,
        body: &Value,
        session: Option<HeaderValue>,
    ) -> Result<Response, ConnectionError> {
        let mut request = self
            .http
            .post(format!("{}/transmission/rpc", self.base))
            .json(body)
            .timeout(self.timeout);
        if !self.username.is_empty() {
            request = request.basic_auth(&self.username, Some(&self.password));
        }
        if let Some(session) = session {
            request = request.header(SESSION_ID, session);
        }
        request
            .send()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))
    }

    /// Call `rpc_method` and return its `arguments`, failing on any `result` but `success`.
    async fn rpc<T: DeserializeOwned>(
        &self,
        rpc_method: &str,
        arguments: Value,
    ) -> Result<T, ConnectionError> {
        let body = json!({"method": rpc_method, "arguments": arguments});
        let mut response = self.post(&body, None).await?;
        if response.status() == StatusCode::CONFLICT {
            let session = response.headers().get(SESSION_ID).cloned();
            response = self.post(&body, session).await?;
        }
        check_status(response.status(), SERVICE, ConnectionError::BadLogin)?;
        let mut reply: Value = response.json().await.map_err(|_| unreadable())?;
        let result = reply["result"].as_str().ok_or_else(unreadable)?;
        if result != "success" {
            return Err(ConnectionError::Rejected(format!(
                "{SERVICE} refused the request: {result}"
            )));
        }
        serde_json::from_value(reply["arguments"].take()).map_err(|_| unreadable())
    }
}

/// An answer that is not the shape Transmission's RPC sends: the address is not Transmission.
fn unreadable() -> ConnectionError {
    ConnectionError::BadUrl(SERVICE.to_string())
}

/// qBittorrent's word for a Transmission torrent. Only a local error counts as one: a
/// tracker's complaint (1, 2) leaves the data coming.
fn state_word(status: u8, error: i64, percent_done: f64) -> &'static str {
    let done = percent_done >= 1.0;
    match (error, status) {
        (3, _) => "error",
        (_, 0) if done => "stoppedUP",
        (_, 0) => "stoppedDL",
        (_, 1 | 2) if done => "checkingUP",
        (_, 1 | 2) => "checkingDL",
        (_, 3) => "queuedDL",
        (_, 5) => "queuedUP",
        (_, 6) => "uploading",
        _ => "downloading",
    }
}

impl From<Torrent> for TorrentStatus {
    fn from(t: Torrent) -> Self {
        TorrentStatus {
            state: state_word(t.status, t.error, t.percent_done).to_string(),
            hash: t.hash_string,
            progress: t.percent_done,
            save_path: t.download_dir,
            // Transmission sends a negative eta for "unknown" and "not available".
            eta: t.eta.filter(|eta| *eta >= 0),
            tags: String::new(),
            added_on: t.added_date,
        }
    }
}

impl DownloadClient for Transmission {
    type Release = Release;

    async fn prepare(&self, link: &str) -> Result<Prepared<Release>, ConnectionError> {
        let release = fetch_torrent(&self.http, link, self.timeout).await?;
        let hash = match &release {
            Release::Magnet(magnet) => infohash::from_magnet(magnet),
            Release::File(bytes) => infohash::from_torrent(bytes),
            Release::NzbLink(_) => return Err(not_torrent()),
        }
        .map_err(|e| rejected(&e.to_string()))?;
        Ok(Prepared { hash, release })
    }

    async fn add(
        &self,
        prepared: Prepared<Release>,
        category: &str,
    ) -> Result<(), ConnectionError> {
        let mut arguments = match prepared.release {
            Release::Magnet(magnet) => json!({"filename": magnet}),
            Release::File(bytes) => json!({"metainfo": STANDARD.encode(bytes)}),
            Release::NzbLink(_) => return Err(not_torrent()),
        };
        if !category.is_empty() {
            arguments["labels"] = json!([category]);
        }
        // A torrent Transmission already holds answers `torrent-duplicate`, also a success.
        self.rpc::<Value>("torrent-add", arguments).await?;
        Ok(())
    }

    async fn status(&self, hash: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        let fields = [
            "hashString",
            "status",
            "error",
            "percentDone",
            "downloadDir",
            "eta",
            "addedDate",
        ];
        let found: Torrents<Torrent> = self
            .rpc("torrent-get", json!({"ids": [hash], "fields": fields}))
            .await?;
        // The check on the answer is for a client that ignores the `ids` filter.
        Ok(found
            .torrents
            .into_iter()
            .find(|t| t.hash_string == hash)
            .map(TorrentStatus::from))
    }

    async fn files(&self, hash: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        let found: Torrents<TorrentFiles> = self
            .rpc(
                "torrent-get",
                json!({"ids": [hash], "fields": ["hashString", "files"]}),
            )
            .await?;
        Ok(found
            .torrents
            .into_iter()
            .find(|t| t.hash_string == hash)
            .map(|t| t.files)
            .unwrap_or_default()
            .into_iter()
            .map(|f| ClientFile {
                name: f.name,
                size: f.length,
            })
            .collect())
    }

    async fn remove(&self, hash: &str, delete_files: bool) -> Result<(), ConnectionError> {
        // Transmission succeeds for an id it does not hold, so a gone torrent is no error.
        let arguments = json!({"ids": [hash], "delete-local-data": delete_files});
        self.rpc::<Value>("torrent-remove", arguments).await?;
        Ok(())
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        self.rpc::<Value>("session-get", json!({})).await?;
        Ok(())
    }
}

fn not_torrent() -> ConnectionError {
    ConnectionError::Rejected(format!("{SERVICE} downloads torrents, not NZB files"))
}

#[cfg(test)]
mod tests;
