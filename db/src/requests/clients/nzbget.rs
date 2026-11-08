//! NZBGet through its JSON-RPC at `/jsonrpc`, with the login as Basic auth. Omnibus appends
//! the NZB itself (base64, under the name `omnibus-<id>.nzb`) rather than handing over the
//! release link, which carries Prowlarr's API key. A job is found by that name, in the
//! download queue and then in history, never by NZBGet's own `NZBID`. A job reports under
//! 1.0 until history says `SUCCESS` (unpacked), in qBittorrent's state words, so the poller
//! never imports a half-built one.
// shortcut: one lookup per call, no ETA: NZBGet's download rate is not read.

use base64::engine::{general_purpose::STANDARD, Engine as _};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::requests::{check_status, http_client, ConnectionError, REQUEST_TIMEOUT};

use super::usenet::{job_name, prepare, JobFolders};
use super::{ClientFile, DownloadClient, Prepared, Release, TorrentStatus};

const SERVICE: &str = "NZBGet";

/// A job under full progress is not done until NZBGet has unpacked it.
const PROGRESS_CAP: f64 = 0.99;

/// A NZBGet instance and the login to reach it. No `Debug`: it holds the password.
pub struct Nzbget {
    http: reqwest::Client,
    base: String,
    username: String,
    password: String,
    timeout: std::time::Duration,
    folders: JobFolders,
}

/// A job in `listgroups`: still downloading or being post-processed.
#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Group {
    #[serde(rename = "NZBID")]
    id: i64,
    #[serde(rename = "NZBName")]
    name: String,
    status: String,
    #[serde(rename = "FileSizeMB")]
    file_mb: f64,
    #[serde(rename = "RemainingSizeMB")]
    remaining_mb: f64,
    final_dir: String,
    dest_dir: String,
}

/// A job in `history`: finished, failed or deleted.
#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct HistoryEntry {
    #[serde(rename = "NZBID")]
    id: i64,
    name: String,
    status: String,
    final_dir: String,
    dest_dir: String,
}

/// Where NZBGet holds a job.
enum Found {
    Group(Group),
    History(HistoryEntry),
}

/// The finished job's folder: where it was unpacked to, else where it was downloaded.
fn folder(final_dir: String, dest_dir: String) -> String {
    if final_dir.is_empty() {
        dest_dir
    } else {
        final_dir
    }
}

impl Found {
    fn id(&self) -> i64 {
        match self {
            Found::Group(group) => group.id,
            Found::History(entry) => entry.id,
        }
    }

    /// The status, or `None` for a job deleted in the client.
    fn into_status(self, id: &str) -> Option<TorrentStatus> {
        let (state, progress, save_path) = match self {
            Found::Group(group) => {
                let state = match group.status.as_str() {
                    "PAUSED" => "pausedDL",
                    "QUEUED" => "queuedDL",
                    "DOWNLOADING" | "FETCHING" => "downloading",
                    // Everything else is post-processing: par check, repair, unpack, move.
                    _ => "checkingDL",
                };
                let share = if group.file_mb > 0.0 {
                    (group.file_mb - group.remaining_mb) / group.file_mb
                } else {
                    0.0
                };
                let save_path = folder(group.final_dir, group.dest_dir);
                (state, share.min(PROGRESS_CAP), save_path)
            }
            Found::History(entry) => {
                let save_path = folder(entry.final_dir, entry.dest_dir);
                match entry.status.split('/').next() {
                    Some("SUCCESS") => ("stoppedUP", 1.0, save_path),
                    Some("DELETED") => return None,
                    _ => ("error", PROGRESS_CAP, save_path),
                }
            }
        };
        Some(TorrentStatus {
            hash: id.to_string(),
            progress,
            state: state.to_string(),
            save_path,
            eta: None,
            tags: String::new(),
            added_on: None,
        })
    }
}

/// An answer that is not the shape NZBGet's JSON-RPC sends: the address is not NZBGet.
fn unreadable() -> ConnectionError {
    ConnectionError::BadUrl(SERVICE.to_string())
}

fn not_nzb() -> ConnectionError {
    ConnectionError::Rejected(format!("{SERVICE} downloads NZB files, not torrents"))
}

impl Nzbget {
    /// A client for the instance at `base_url`, such as `http://nzbget:6789`.
    pub fn new(base_url: &str, username: &str, password: &str) -> Result<Self, ConnectionError> {
        Ok(Self {
            http: http_client()?,
            base: base_url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
            timeout: REQUEST_TIMEOUT,
            folders: JobFolders::default(),
        })
    }

    /// The same client, reading job folders through `folders`.
    pub fn with_folders(self, folders: JobFolders) -> Self {
        Self { folders, ..self }
    }

    /// Call `rpc_method` and return its `result`, failing on an `error` member.
    async fn rpc<T: DeserializeOwned>(
        &self,
        rpc_method: &str,
        params: Value,
    ) -> Result<T, ConnectionError> {
        let mut request = self
            .http
            .post(format!("{}/jsonrpc", self.base))
            .json(&json!({"method": rpc_method, "params": params, "id": 1}))
            .timeout(self.timeout);
        if !self.username.is_empty() {
            request = request.basic_auth(&self.username, Some(&self.password));
        }
        let response = request
            .send()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        check_status(response.status(), SERVICE, ConnectionError::BadLogin)?;
        let mut body: Value = response.json().await.map_err(|_| unreadable())?;
        if let Some(error) = body.get("error") {
            let why = error["message"]
                .as_str()
                .unwrap_or("it refused the request");
            return Err(ConnectionError::Rejected(format!(
                "{SERVICE} refused the request: {why}"
            )));
        }
        serde_json::from_value(body["result"].take()).map_err(|_| unreadable())
    }

    /// The job named exactly `name`, in the queue first and then in history.
    async fn find(&self, name: &str) -> Result<Option<Found>, ConnectionError> {
        let groups: Vec<Group> = self.rpc("listgroups", json!([0])).await?;
        if let Some(group) = groups.into_iter().find(|g| g.name == name) {
            return Ok(Some(Found::Group(group)));
        }
        let history: Vec<HistoryEntry> = self.rpc("history", json!([false])).await?;
        Ok(history
            .into_iter()
            .find(|h| h.name == name)
            .map(Found::History))
    }
}

impl DownloadClient for Nzbget {
    type Release = Release;

    async fn prepare(&self, link: &str) -> Result<Prepared<Release>, ConnectionError> {
        prepare(&self.http, link, self.timeout).await
    }

    async fn add(
        &self,
        prepared: Prepared<Release>,
        category: &str,
    ) -> Result<(), ConnectionError> {
        let Release::Nzb(bytes) = prepared.release else {
            return Err(not_nzb());
        };
        let name = format!("{}.nzb", job_name(&prepared.hash));
        // Name, content, category, priority, top, paused, dupe key, score, mode, parameters.
        let params = json!([
            name,
            STANDARD.encode(bytes),
            category,
            0,
            false,
            false,
            "",
            0,
            "SCORE",
            []
        ]);
        let id: i64 = self.rpc("append", params).await?;
        if id <= 0 {
            return Err(ConnectionError::Rejected(format!(
                "{SERVICE} did not accept the NZB"
            )));
        }
        Ok(())
    }

    async fn hash_for_tag(&self, _tag: &str) -> Result<Option<String>, ConnectionError> {
        // Only a qBittorrent download was ever tagged.
        Ok(None)
    }

    async fn status(&self, hash: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        let found = self.find(&job_name(hash)).await?;
        Ok(found.and_then(|f| f.into_status(hash)))
    }

    async fn files(&self, hash: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        let Some(status) = self.status(hash).await? else {
            return Ok(Vec::new());
        };
        Ok(self.folders.files(&status.save_path).await)
    }

    async fn remove(&self, hash: &str, delete_files: bool) -> Result<(), ConnectionError> {
        let Some(found) = self.find(&job_name(hash)).await? else {
            return Ok(());
        };
        let command = match (&found, delete_files) {
            (Found::Group(_), true) => "GroupFinalDelete",
            (Found::Group(_), false) => "GroupDelete",
            (Found::History(_), true) => "HistoryFinalDelete",
            (Found::History(_), false) => "HistoryDelete",
        };
        self.rpc::<bool>("editqueue", json!([command, "", [found.id()]]))
            .await?;
        Ok(())
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        self.rpc::<String>("version", json!([])).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
