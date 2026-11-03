//! A scripted [`DownloadClient`] for the request pipeline's tests: answers `status` from a
//! table the test fills, can fail every call as an unreachable client would, and records
//! each call so a test can read back what the pipeline asked for.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::settings::RequestsConfig;
use omnibus_shared::DownloadClientKind;

use super::clients::{ClientFile, DownloadClient, TorrentStatus};
use super::ConnectionError;

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
            content_path: String::new(),
            save_path: String::new(),
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
