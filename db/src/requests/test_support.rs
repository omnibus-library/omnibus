//! A scripted [`DownloadClient`] for the request pipeline's tests: answers `status` from a
//! table the test fills, can fail every call as an unreachable client would, and records
//! each call so a test can read back what the pipeline asked for.

use std::collections::HashMap;
use std::sync::Mutex;

use omnibus_shared::{DownloadClientKind, RequestKind};
use sqlx::SqlitePool;

use crate::settings::RequestsConfig;
use crate::test_support::seed_user;

use super::clients::{infohash, ClientFile, DownloadClient, Prepared, TorrentStatus};
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
         VALUES (?, 'g', 't', ?, 1.0) RETURNING id",
    )
    .bind(id)
    .bind(magnet(id))
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
        "client_hash = '{}', progress = {progress}, moved_at = {moved_at}",
        hash(id)
    );
    update(pool, id, &set).await;
    id
}

/// The info hash of request `id`'s pick: every request seeded here links a magnet of its own.
pub fn hash(id: i64) -> String {
    format!("{id:040x}")
}

/// The tag an earlier version gave request `id`'s download, which 0119 keeps as `legacy_tag`.
pub fn tag(id: i64) -> String {
    format!("omnibus-{id}-{id}")
}

/// The magnet a request seeded here picked.
pub fn magnet(id: i64) -> String {
    format!("magnet:?xt=urn:btih:{}&dn=t", hash(id))
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
    Add { link: String, category: String },
    Status(String),
    TagLookup(String),
    Files(String),
    Remove { hash: String, delete_files: bool },
}

#[derive(Default)]
struct Script {
    statuses: HashMap<String, TorrentStatus>,
    files: HashMap<String, Vec<ClientFile>>,
    unreachable: bool,
    /// `add` leaves the torrent in the client, then fails as a lost answer would.
    adds_then_fails: bool,
    /// Info hashes whose link `add` refuses.
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

    /// Give the download with info hash `hash` this `progress` and client `state` word.
    pub fn with_status(self, hash: &str, progress: f64, state: &str) -> Self {
        self.appears(hash, progress, state);
        self
    }

    /// The client expects the download with info hash `hash` to take `eta` more seconds.
    pub fn with_eta(self, hash: &str, eta: i64) -> Self {
        if let Some(status) = self.script().statuses.get_mut(hash) {
            status.eta = Some(eta);
        }
        self
    }

    /// Give the download with info hash `hash` finished, saved in `save_path` and holding `files`
    /// (name and size).
    pub fn with_files(self, hash: &str, save_path: &str, files: &[(&str, u64)]) -> Self {
        self.appears(hash, 1.0, "stalledUP");
        let mut script = self.script();
        if let Some(status) = script.statuses.get_mut(hash) {
            status.save_path = save_path.to_string();
        }
        let listed = files
            .iter()
            .map(|(name, size)| ClientFile {
                name: (*name).to_string(),
                size: *size,
            })
            .collect();
        script.files.insert(hash.to_string(), listed);
        drop(script);
        self
    }

    /// The client reports the download with info hash `hash` in `state`, keeping the rest of its status.
    pub fn with_state(self, hash: &str, state: &str) -> Self {
        if let Some(status) = self.script().statuses.get_mut(hash) {
            status.state = state.to_string();
        }
        self
    }

    /// A client whose `add` takes the torrent but answers with a failure.
    pub fn adding_then_failing(self) -> Self {
        self.script().adds_then_fails = true;
        self
    }

    /// The client carries `tag` on the download with info hash `hash`, as one an earlier
    /// version of Omnibus tagged.
    pub fn with_tag(self, hash: &str, tag: &str) -> Self {
        if let Some(status) = self.script().statuses.get_mut(hash) {
            status.tags = tag.to_string();
        }
        self
    }

    /// A client that refuses to add a download with info hash `hash`.
    pub fn refusing(self, hash: &str) -> Self {
        self.script().refused.push(hash.to_string());
        self
    }

    /// The client starts showing the download with info hash `hash`, as a link it fetched at last.
    pub fn appears(&self, hash: &str, progress: f64, state: &str) {
        let status = TorrentStatus {
            hash: hash.to_string(),
            progress,
            state: state.to_string(),
            save_path: String::new(),
            eta: None,
            tags: String::new(),
            added_on: None,
        };
        self.script().statuses.insert(hash.to_string(), status);
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
    type Release = String;

    async fn prepare(&self, link: &str) -> Result<Prepared<String>, ConnectionError> {
        let hash = infohash::from_magnet(link)
            .map_err(|e| ConnectionError::Rejected(format!("the release link {e}")))?;
        Ok(Prepared {
            hash,
            release: link.to_string(),
        })
    }

    async fn add(&self, prepared: Prepared<String>, category: &str) -> Result<(), ConnectionError> {
        self.record(Call::Add {
            link: prepared.release,
            category: category.to_string(),
        })?;
        let mut script = self.script();
        if script.refused.contains(&prepared.hash) {
            return Err(ConnectionError::Rejected(
                "stub refused the link".to_string(),
            ));
        }
        let hash = prepared.hash.clone();
        script
            .statuses
            .entry(hash.clone())
            .or_insert_with(|| TorrentStatus {
                hash,
                progress: 0.0,
                state: "downloading".to_string(),
                save_path: String::new(),
                eta: None,
                tags: String::new(),
                added_on: None,
            });
        if script.adds_then_fails {
            return Err(ConnectionError::Unreachable("stub".to_string()));
        }
        Ok(())
    }

    async fn hash_for_tag(&self, tag: &str) -> Result<Option<String>, ConnectionError> {
        self.record(Call::TagLookup(tag.to_string()))?;
        let script = self.script();
        Ok(script
            .statuses
            .values()
            .filter(|t| t.tags.split(',').any(|candidate| candidate.trim() == tag))
            .max_by_key(|t| t.added_on)
            .map(|t| t.hash.clone()))
    }

    async fn status(&self, hash: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        self.record(Call::Status(hash.to_string()))?;
        Ok(self.script().statuses.get(hash).cloned())
    }

    async fn files(&self, hash: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        self.record(Call::Files(hash.to_string()))?;
        Ok(self.script().files.get(hash).cloned().unwrap_or_default())
    }

    async fn remove(&self, hash: &str, delete_files: bool) -> Result<(), ConnectionError> {
        self.record(Call::Remove {
            hash: hash.to_string(),
            delete_files,
        })?;
        self.script().statuses.remove(hash);
        Ok(())
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        Ok(())
    }
}
