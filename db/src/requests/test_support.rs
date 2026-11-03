//! A scripted [`DownloadClient`] for the request pipeline's tests: answers `status` from a
//! table the test fills, can fail every call as an unreachable client would, and records
//! each call so a test can read back what the pipeline asked for.

use std::collections::HashMap;
use std::sync::Mutex;

use super::clients::{ClientFile, DownloadClient, TorrentStatus};
use super::ConnectionError;

/// One call the pipeline made to the client.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    Add {
        link: String,
        category: String,
        tag: String,
    },
    Status(String),
    Remove {
        tag: String,
        delete_files: bool,
    },
}

#[derive(Default)]
struct Script {
    statuses: HashMap<String, TorrentStatus>,
    unreachable: bool,
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
        let status = TorrentStatus {
            hash: format!("hash-{tag}"),
            progress,
            state: state.to_string(),
            content_path: String::new(),
        };
        self.script().statuses.insert(tag.to_string(), status);
        self
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
        })
    }

    async fn status(&self, tag: &str) -> Result<Option<TorrentStatus>, ConnectionError> {
        self.record(Call::Status(tag.to_string()))?;
        Ok(self.script().statuses.get(tag).cloned())
    }

    async fn files(&self, _tag: &str) -> Result<Vec<ClientFile>, ConnectionError> {
        Ok(Vec::new())
    }

    async fn remove(&self, tag: &str, delete_files: bool) -> Result<(), ConnectionError> {
        self.record(Call::Remove {
            tag: tag.to_string(),
            delete_files,
        })
    }

    async fn test(&self) -> Result<(), ConnectionError> {
        Ok(())
    }
}
