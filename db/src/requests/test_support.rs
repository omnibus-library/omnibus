//! A scripted [`DownloadClient`] for the request pipeline's tests: answers `status` from a
//! table the test fills, can fail every call as an unreachable client would, and records
//! each call so a test can read back what the pipeline asked for.

use std::collections::HashMap;
use std::sync::Mutex;

use omnibus_shared::{DownloadClientKind, RequestKind};
use sqlx::SqlitePool;

use crate::settings::RequestsConfig;
use crate::test_support::seed_user;

use super::clients::{ClientFile, DownloadClient, TorrentStatus};
use super::store;
use super::ConnectionError;

/// A new reader named `reader` with a `kind` request for `book_uuid` in `state`, and a version
/// of it picked. Returns the request's id.
pub async fn seed_picked(
    pool: &SqlitePool,
    reader: &str,
    book_uuid: &str,
    kind: RequestKind,
    state: &str,
) -> i64 {
    let user = seed_user(pool, reader).await;
    let id = store::start(pool, user, book_uuid, kind, 5)
        .await
        .unwrap()
        .request
        .id;
    pick(pool, id, state).await;
    id
}

/// Give request `id` a result it picked, and put it in `state`.
pub async fn pick(pool: &SqlitePool, id: i64, state: &str) {
    let result: i64 = sqlx::query_scalar(
        "INSERT INTO book_request_results (request_id, guid, title, download_url, score)
         VALUES (?, 'g', 't', 'magnet:?xt=urn:btih:abc', 1.0) RETURNING id",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap();
    update(
        pool,
        id,
        &format!("state = '{state}', chosen_result_id = {result}"),
    )
    .await;
}

/// A reader named `name` with an ebook request in `state` for a book of the same name, and a
/// version of it picked. Returns the request's id.
pub async fn seed(pool: &SqlitePool, name: &str, state: &str) -> i64 {
    seed_picked(pool, name, name, RequestKind::Ebook, state).await
}

/// Run `UPDATE book_requests SET <set> WHERE id = <id>`.
pub async fn update(pool: &SqlitePool, id: i64, set: &str) {
    sqlx::query(&format!("UPDATE book_requests SET {set} WHERE id = {id}"))
        .execute(pool)
        .await
        .unwrap();
}

/// A request on its way whose download reported `progress` at `moved_at`.
pub async fn on_its_way(pool: &SqlitePool, name: &str, progress: f64, moved_at: i64) -> i64 {
    let id = seed(pool, name, "on_its_way").await;
    let set = format!(
        "client_tag = '{}', progress = {progress}, moved_at = {moved_at}",
        tag(id)
    );
    update(pool, id, &set).await;
    id
}

/// The tag of request `id`'s pick, as the poller names it. Every request seeded here holds
/// one version, whose id equals the request's.
pub fn tag(id: i64) -> String {
    format!("omnibus-{id}-{id}")
}

/// Connection settings with no services set up and the two download folders as given.
pub fn requests_config(client_prefix: Option<&str>, local_prefix: Option<&str>) -> RequestsConfig {
    RequestsConfig {
        prowlarr_url: None,
        prowlarr_api_key: None,
        download_client_kind: DownloadClientKind::Qbittorrent,
        download_client_url: None,
        download_client_username: None,
        download_client_password: None,
        download_client_category: "omnibus".to_string(),
        download_client_path_prefix: client_prefix.map(str::to_string),
        download_path_prefix: local_prefix.map(str::to_string),
    }
}

/// One call the pipeline made to the client.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    Add {
        link: String,
        category: String,
        tag: String,
    },
    Status(String),
    Files(String),
    Remove {
        tag: String,
        delete_files: bool,
    },
}

#[derive(Default)]
struct Script {
    statuses: HashMap<String, TorrentStatus>,
    files: HashMap<String, Vec<ClientFile>>,
    unreachable: bool,
    /// Tags whose link `add` refuses.
    refused: Vec<String>,
    calls: Vec<Call>,
}

/// The fake client: no network, one in-memory script.
#[derive(Default)]
pub struct StubClient(Mutex<Script>);

impl StubClient {
    /// A client that has no downloads and answers every call.
    pub fn new() -> Self {
        Self::default()
    }

    /// A client whose every call fails as if it could not be reached.
    pub fn unreachable() -> Self {
        let stub = Self::default();
        stub.script().unreachable = true;
        stub
    }

    /// Give the download marked `tag` this `progress` and client `state` word.
    pub fn with_status(self, tag: &str, progress: f64, state: &str) -> Self {
        self.appears(tag, progress, state);
        self
    }

    /// The client expects the download marked `tag` to take `eta` more seconds.
    pub fn with_eta(self, tag: &str, eta: i64) -> Self {
        if let Some(status) = self.script().statuses.get_mut(tag) {
            status.eta = Some(eta);
        }
        self
    }

    /// Give the download marked `tag` finished, saved in `save_path` and holding `files`
    /// (name and size).
    pub fn with_files(self, tag: &str, save_path: &str, files: &[(&str, u64)]) -> Self {
        self.appears(tag, 1.0, "stalledUP");
        let mut script = self.script();
        if let Some(status) = script.statuses.get_mut(tag) {
            status.save_path = save_path.to_string();
        }
        let listed = files
            .iter()
            .map(|(name, size)| ClientFile {
                name: (*name).to_string(),
                size: *size,
            })
            .collect();
        script.files.insert(tag.to_string(), listed);
        drop(script);
        self
    }

    /// The client reports the download marked `tag` in `state`, keeping the rest of its status.
    pub fn with_state(self, tag: &str, state: &str) -> Self {
        if let Some(status) = self.script().statuses.get_mut(tag) {
            status.state = state.to_string();
        }
        self
    }

    /// A client that refuses to add a download marked `tag`.
    pub fn refusing(self, tag: &str) -> Self {
        self.script().refused.push(tag.to_string());
        self
    }

    /// The client starts showing the download marked `tag`, as a link it fetched at last.
    pub fn appears(&self, tag: &str, progress: f64, state: &str) {
        let status = TorrentStatus {
            hash: format!("hash-{tag}"),
            progress,
            state: state.to_string(),
            save_path: String::new(),
            eta: None,
        };
        self.script().statuses.insert(tag.to_string(), status);
    }

    /// Every call made so far, oldest first.
    pub fn calls(&self) -> Vec<Call> {
        self.script().calls.clone()
    }

    fn script(&self) -> std::sync::MutexGuard<'_, Script> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn record(&self, call: Call) -> Result<(), ConnectionError> {
        let mut script = self.script();
        script.calls.push(call);
        if script.unreachable {
            return Err(ConnectionError::Unreachable("stub".to_string()));
        }
        Ok(())
    }
}

impl DownloadClient for StubClient {
    async fn add(&self, link: &str, category: &str, tag: &str) -> Result<(), ConnectionError> {
        self.record(Call::Add {
            link: link.to_string(),
            category: category.to_string(),
            tag: tag.to_string(),
        })?;
        if self.script().refused.iter().any(|t| t == tag) {
            return Err(ConnectionError::Rejected(
                "stub refused the link".to_string(),
            ));
        }
        Ok(())
    }

    async fn status(&self, tag: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        self.record(Call::Status(tag.to_string()))?;
        Ok(self.script().statuses.get(tag).cloned())
    }

    async fn files(&self, tag: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        self.record(Call::Files(tag.to_string()))?;
        Ok(self.script().files.get(tag).cloned().unwrap_or_default())
    }

    async fn remove(&self, tag: &str, delete_files: bool) -> Result<(), ConnectionError> {
        self.record(Call::Remove {
            tag: tag.to_string(),
            delete_files,
        })?;
        self.script().statuses.remove(tag);
        Ok(())
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        Ok(())
    }
}
