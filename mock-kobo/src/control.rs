//! One running device: the state the control API reads and drives.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::client::RequestRecord;
use crate::device::{Book, Device};
use crate::firmware::Quirk;
use crate::session::{attempt_sync, SyncFailure};
use crate::state::{self, SavedState, StateError};

/// One running device: what the control API (and a TUI) reads and drives.
pub struct Control {
    url: String,
    state_path: PathBuf,
    live: Mutex<Live>,
    /// Serializes saves, so the snapshot written last is always the newest.
    save_lock: tokio::sync::Mutex<()>,
}

/// The parts of a running device that change.
struct Live {
    saved: SavedState,
    syncing: bool,
    last_sync: Option<LastSync>,
    requests: Vec<RequestRecord>,
}

/// How the last sync ended, as `GET /device` shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum LastSync {
    Synced {
        pages: usize,
    },
    /// `message` is the `SyncFailure` text, already token-redacted.
    Failed {
        quirk: Option<Quirk>,
        message: String,
    },
}

/// What `PUT /reset` tells the caller about the server's delivery record.
pub const RESET_MESSAGE: &str = "device reset; Omnibus still remembers what it sent this device until #2743, \
so the next sync sends only changes — remove the device in Account settings and add it again for a full resend";

/// Why the control API couldn't do what it was asked.
#[derive(Debug, thiserror::Error)]
pub enum ControlError {
    #[error("a sync is already running")]
    SyncInProgress,
    #[error("device state not saved: {0}")]
    StateNotSaved(#[from] StateError),
}

/// What `GET /device` shows. Never carries the device token.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DeviceView {
    pub hardware_id: String,
    pub url: String,
    pub syncing: bool,
    pub last_sync: Option<LastSync>,
    pub sync_token: Option<String>,
    pub library: BTreeMap<String, Book>,
}

impl Control {
    /// A device restored from (or just written to) `state_path`, syncing against `url`.
    pub fn new(saved: SavedState, url: String, state_path: PathBuf) -> Self {
        Self {
            url,
            state_path,
            save_lock: tokio::sync::Mutex::new(()),
            live: Mutex::new(Live {
                saved,
                syncing: false,
                last_sync: None,
                requests: Vec::new(),
            }),
        }
    }

    /// The device as `GET /device` reports it.
    pub fn view(&self) -> DeviceView {
        let live = self.live();
        DeviceView {
            hardware_id: live.saved.device.hardware_id.clone(),
            url: self.url.clone(),
            syncing: live.syncing,
            last_sync: live.last_sync.clone(),
            sync_token: live.saved.device.sync_token.clone(),
            library: live.saved.device.library.clone(),
        }
    }

    /// Press "Sync now" against `<url>/kobo/<token>`.
    pub async fn sync(&self) -> Result<LastSync, ControlError> {
        let (_syncing, mut device, token) = self.begin_sync()?;
        let endpoint = format!("{}/kobo/{token}", self.url);
        let attempt = attempt_sync(&mut device, &endpoint).await;
        let last_sync = match attempt.outcome {
            Ok(pages) => LastSync::Synced { pages },
            Err(failure) => LastSync::Failed {
                quirk: quirk_of(&failure),
                message: failure.to_string(),
            },
        };
        {
            let mut live = self.live();
            live.saved.device = device;
            live.last_sync = Some(last_sync.clone());
            live.requests.extend(attempt.requests);
        }
        self.persist().await?;
        Ok(last_sync)
    }

    /// Mark a sync as running and hand back what it works on, or turn it away if one already is.
    fn begin_sync(&self) -> Result<(SyncingGuard<'_>, Device, String), ControlError> {
        let (device, token) = {
            let mut live = self.live();
            if live.syncing {
                return Err(ControlError::SyncInProgress);
            }
            live.syncing = true;
            (live.saved.device.clone(), live.saved.token.clone())
        };
        Ok((SyncingGuard(self), device, token))
    }

    /// Wipe what the device holds; keep who it is and where it syncs.
    pub async fn reset(&self) -> Result<DeviceView, ControlError> {
        {
            let mut live = self.live();
            if live.syncing {
                return Err(ControlError::SyncInProgress);
            }
            live.saved.device.library.clear();
            live.saved.device.sync_token = None;
            live.last_sync = None;
            live.requests.clear();
        }
        self.persist().await?;
        Ok(self.view())
    }

    /// Every request the device made since start or the last reset, oldest first.
    pub fn requests(&self) -> Vec<RequestRecord> {
        self.live().requests.clone()
    }

    /// Write the current state to the state file.
    async fn persist(&self) -> Result<(), StateError> {
        let _saving = self.save_lock.lock().await;
        let snapshot = self.live().saved.clone();
        state::save(&self.state_path, &snapshot).await
    }

    /// The lock on the live state; a panic elsewhere never makes the device unreadable.
    fn live(&self) -> MutexGuard<'_, Live> {
        self.live.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Clears `syncing` when a sync ends for any reason, including its caller being cancelled.
struct SyncingGuard<'a>(&'a Control);

impl Drop for SyncingGuard<'_> {
    fn drop(&mut self) {
        self.0.live().syncing = false;
    }
}

/// The firmware rule a failed sync tripped, if it tripped one.
fn quirk_of(failure: &SyncFailure) -> Option<Quirk> {
    match failure {
        SyncFailure::Quirk { quirk, .. } => Some(*quirk),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
