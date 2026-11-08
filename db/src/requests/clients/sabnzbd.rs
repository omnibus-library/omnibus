//! SABnzbd through its API at `/api`. The API key travels as a query parameter, which is
//! the API's own shape, so no error here echoes a URL. Omnibus uploads the NZB (`addfile`)
//! under the name `omnibus-<id>` rather than handing over the release link, which carries
//! Prowlarr's API key. A job is found by that exact name, in the queue and then in history,
//! never by SABnzbd's own `nzo_id`. A job reports under 1.0 until it is `Completed`
//! (unpacked), in qBittorrent's state words, so the poller never imports a half-built one.
// shortcut: one lookup per call, no ETA: SABnzbd's `timeleft` is not read.

use omnibus_shared::ReleaseProtocol;
use reqwest::multipart::{Form, Part};
use reqwest::RequestBuilder;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::requests::{check_status, http_client, ConnectionError, REQUEST_TIMEOUT};

use super::release::fetch_nzb;
use super::usenet::{job_name, prepare, JobFolders, UNPACKING_PROGRESS};
use super::{ClientFile, DownloadClient, Prepared, Release, TorrentStatus};

const SERVICE: &str = "SABnzbd";

/// A SABnzbd instance and its API key. No `Debug`: it holds the key.
pub struct Sabnzbd {
    http: reqwest::Client,
    base: String,
    api_key: String,
    timeout: std::time::Duration,
    folders: JobFolders,
}

#[derive(serde::Deserialize)]
struct Slots<T> {
    slots: Vec<T>,
}

#[derive(serde::Deserialize)]
struct QueueReply {
    queue: Slots<QueueSlot>,
}

#[derive(serde::Deserialize)]
struct HistoryReply {
    history: Slots<HistorySlot>,
}

#[derive(serde::Deserialize)]
struct QueueSlot {
    nzo_id: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    status: String,
    /// A string such as `"45"` in most versions.
    #[serde(default)]
    percentage: Value,
}

#[derive(serde::Deserialize)]
struct HistorySlot {
    nzo_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    storage: String,
}

/// Where SABnzbd holds a job.
enum Found {
    Queue(QueueSlot),
    History(HistorySlot),
}

impl Found {
    fn nzo_id(&self) -> &str {
        match self {
            Found::Queue(slot) => &slot.nzo_id,
            Found::History(slot) => &slot.nzo_id,
        }
    }

    fn into_status(self, id: &str) -> TorrentStatus {
        let (state, progress, save_path) = match self {
            Found::Queue(slot) => {
                let state = match slot.status.as_str() {
                    "Paused" => "pausedDL",
                    "Queued" | "Grabbing" | "Fetching" | "Propagating" => "queuedDL",
                    _ => "downloading",
                };
                let share = percentage(&slot.percentage) / 100.0;
                (state, share.min(UNPACKING_PROGRESS), String::new())
            }
            Found::History(slot) => match slot.status.as_str() {
                "Completed" => ("stoppedUP", 1.0, slot.storage),
                "Failed" => ("error", UNPACKING_PROGRESS, slot.storage),
                // Verifying, repairing, extracting, moving: not yet in its final folder.
                _ => ("checkingDL", UNPACKING_PROGRESS, slot.storage),
            },
        };
        TorrentStatus {
            hash: id.to_string(),
            progress,
            state: state.to_string(),
            save_path,
            eta: None,
            tags: String::new(),
            added_on: None,
        }
    }
}

fn percentage(value: &Value) -> f64 {
    match value {
        Value::String(s) => s.trim().parse().unwrap_or(0.0),
        other => other.as_f64().unwrap_or(0.0),
    }
}

/// An answer that is not the shape SABnzbd's API sends: the address is not SABnzbd.
fn unreadable() -> ConnectionError {
    ConnectionError::BadUrl(SERVICE.to_string())
}

fn not_nzb() -> ConnectionError {
    ConnectionError::Rejected(format!("{SERVICE} downloads NZB files, not torrents"))
}

impl Sabnzbd {
    /// A client for the instance at `base_url`, such as `http://sabnzbd:8080`.
    pub fn new(base_url: &str, api_key: &str) -> Result<Self, ConnectionError> {
        Ok(Self {
            http: http_client()?,
            base: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            timeout: REQUEST_TIMEOUT,
            folders: JobFolders::default(),
        })
    }

    /// The same client, reading job folders through `folders`.
    pub fn with_folders(self, folders: JobFolders) -> Self {
        Self { folders, ..self }
    }

    fn api(&self) -> String {
        format!("{}/api", self.base)
    }

    /// Send `request` and return SABnzbd's JSON answer, failing on a `status: false` one.
    async fn send(&self, request: RequestBuilder) -> Result<Value, ConnectionError> {
        let response = request
            .query(&[("output", "json"), ("apikey", &self.api_key)])
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|e| ConnectionError::from_transport(&e))?;
        check_status(response.status(), SERVICE, ConnectionError::BadApiKey)?;
        let body: Value = response.json().await.map_err(|_| unreadable())?;
        if body["status"] != Value::Bool(false) {
            return Ok(body);
        }
        let why = body["error"].as_str().unwrap_or("it refused the request");
        Err(if why.to_ascii_lowercase().contains("api key") {
            ConnectionError::BadApiKey
        } else {
            ConnectionError::Rejected(format!("{SERVICE} refused the request: {why}"))
        })
    }

    async fn get<T: DeserializeOwned>(
        &self,
        params: &[(&str, &str)],
    ) -> Result<T, ConnectionError> {
        let body = self.send(self.http.get(self.api()).query(params)).await?;
        serde_json::from_value(body).map_err(|_| unreadable())
    }

    /// The job named exactly `name`, in the queue first and then in history. SABnzbd's
    /// `search` matches a part of a name, so the answer is checked for the whole of it.
    async fn find(&self, name: &str) -> Result<Option<Found>, ConnectionError> {
        let params = |mode| [("mode", mode), ("search", name), ("limit", "50")];
        let queue: QueueReply = self.get(&params("queue")).await?;
        if let Some(slot) = queue.queue.slots.into_iter().find(|s| s.filename == name) {
            return Ok(Some(Found::Queue(slot)));
        }
        let history: HistoryReply = self.get(&params("history")).await?;
        Ok(history
            .history
            .slots
            .into_iter()
            .find(|s| s.name == name)
            .map(Found::History))
    }
}

impl DownloadClient for Sabnzbd {
    type Release = Release;

    async fn prepare(&self, link: &str) -> Result<Prepared<Release>, ConnectionError> {
        prepare(link)
    }

    async fn add(
        &self,
        prepared: Prepared<Release>,
        category: &str,
    ) -> Result<(), ConnectionError> {
        let Release::NzbLink(link) = prepared.release else {
            return Err(not_nzb());
        };
        let bytes = fetch_nzb(&self.http, &link, self.timeout).await?;
        let name = job_name(&prepared.hash);
        let file = Part::bytes(bytes)
            .file_name(format!("{name}.nzb"))
            .mime_str("application/x-nzb")
            .map_err(|e| ConnectionError::from_transport(&e))?;
        let mut query = vec![("mode", "addfile"), ("nzbname", name.as_str())];
        if !category.is_empty() {
            query.push(("cat", category));
        }
        let request = self
            .http
            .post(self.api())
            .query(&query)
            .multipart(Form::new().part("name", file));
        let body = self.send(request).await?;
        let added = body["nzo_ids"]
            .as_array()
            .is_some_and(|ids| !ids.is_empty());
        if !added {
            return Err(ConnectionError::Rejected(format!(
                "{SERVICE} did not accept the NZB"
            )));
        }
        Ok(())
    }

    fn protocol(&self) -> ReleaseProtocol {
        ReleaseProtocol::Usenet
    }

    async fn status(&self, hash: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        let found = self.find(&job_name(hash)).await?;
        Ok(found.map(|f| f.into_status(hash)))
    }

    async fn files(&self, hash: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        let Some(status) = self.status(hash).await? else {
            return Ok(Vec::new());
        };
        if status.save_path.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self.folders.files(&status.save_path).await)
    }

    async fn remove(&self, hash: &str, delete_files: bool) -> Result<(), ConnectionError> {
        let Some(found) = self.find(&job_name(hash)).await? else {
            return Ok(());
        };
        let mode = match found {
            Found::Queue(_) => "queue",
            Found::History(_) => "history",
        };
        let del_files = if delete_files { "1" } else { "0" };
        let params = [
            ("mode", mode),
            ("name", "delete"),
            ("value", found.nzo_id()),
            ("del_files", del_files),
            // Out of history for good, not into its archive.
            ("archive", "0"),
        ];
        self.get::<Value>(&params).await?;
        Ok(())
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        self.get::<Value>(&[("mode", "queue"), ("limit", "0")])
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
