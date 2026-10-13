//! One running device: the state the control API reads and drives.
//! A sync runs on its own task, so a caller that disconnects never cancels it
//! half-way. A reset clears what the device holds, but Omnibus still remembers
//! what it delivered, so the next sync sends only changes. A retarget changes
//! the URL or token between syncs; a sync reads both under one lock, so it
//! never mixes two targets, and never sends a token auto-wired for another URL.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::client::RequestRecord;
use crate::device::{Book, Device};
use crate::firmware::Quirk;
use crate::session::{attempt_sync, SyncFailure};
use crate::state::{self, SavedState, StateError};

/// One running device: what the control API (and a TUI) reads and drives.
pub struct Control {
    state_path: PathBuf,
    live: Mutex<Live>,
    /// Serializes saves, so the snapshot written last is always the newest.
    save_lock: tokio::sync::Mutex<()>,
    /// Woken whenever a sync ends.
    sync_ended: tokio::sync::Notify,
}

/// The parts of a running device that change.
struct Live {
    saved: SavedState,
    /// The origin syncs go to: the pinned URL if there is one, else the one discovered at start.
    url: String,
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

/// Where `Control::retarget` points the device.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Retarget {
    /// Pin this origin (one `cli::valid_url` accepted); the token and its `wired_url` stay.
    Url(String),
    /// A token the user gave (one `cli::valid_token` accepted); `wired_url` becomes `None`.
    Token(String),
    /// A token auto-wire minted against `url`; `wired_url` becomes `Some(url)`.
    Wired { token: String, url: String },
}

/// What a retarget left the device with.
#[derive(Clone, Debug, PartialEq)]
pub struct Retargeted {
    pub view: DeviceView,
    /// The token was auto-wired against another origin than the device now syncs with.
    pub needs_wire: bool,
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
            state_path,
            save_lock: tokio::sync::Mutex::new(()),
            sync_ended: tokio::sync::Notify::new(),
            live: Mutex::new(Live {
                saved,
                url,
                syncing: false,
                last_sync: None,
                requests: Vec::new(),
            }),
        }
    }

    /// The device as `GET /device` reports it.
    pub fn view(&self) -> DeviceView {
        self.live().view()
    }

    /// Press "Sync now" against `<url>/kobo/<token>`. The sync runs on its own
    /// task, so dropping the caller (a client disconnect) never cancels it.
    /// A token auto-wired for another server is never sent: the sync fails without a request.
    pub async fn sync(self: &Arc<Self>) -> Result<LastSync, ControlError> {
        let (syncing, device, endpoint) = match self.begin_sync()? {
            Begun::Run(syncing, device, endpoint) => (syncing, device, endpoint),
            Begun::Refused(refused) => return Ok(refused),
        };
        let control = Arc::clone(self);
        let task = tokio::spawn(async move { control.run_sync(syncing, device, endpoint).await });
        match task.await {
            Ok(result) => result,
            Err(error) => std::panic::resume_unwind(
                error
                    .try_into_panic()
                    .unwrap_or_else(|cancelled| Box::new(cancelled.to_string())),
            ),
        }
    }

    /// Mark a sync as running and hand back what it works on, or turn it away if one already is.
    /// The endpoint is read with the flag, so a retarget never lands between them.
    fn begin_sync(self: &Arc<Self>) -> Result<Begun, ControlError> {
        let (device, endpoint) = {
            let mut live = self.live();
            if live.syncing {
                return Err(ControlError::SyncInProgress);
            }
            if let Some(refused) = live.refusal() {
                live.last_sync = Some(refused.clone());
                return Ok(Begun::Refused(refused));
            }
            live.syncing = true;
            let endpoint = format!("{}/kobo/{}", live.url, live.saved.token);
            (live.saved.device.clone(), endpoint)
        };
        Ok(Begun::Run(SyncingGuard(Arc::clone(self)), device, endpoint))
    }

    /// Sync `device`, commit what it learned, and save; `_syncing` clears the flag when this ends.
    async fn run_sync(
        &self,
        _syncing: SyncingGuard,
        mut device: Device,
        endpoint: String,
    ) -> Result<LastSync, ControlError> {
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

    /// Return once no sync is running, so a caller about to exit never cuts one short.
    pub async fn wait_until_idle(&self) {
        loop {
            let ended = self.sync_ended.notified();
            tokio::pin!(ended);
            // Registered before the check, so an end between the two is not missed.
            ended.as_mut().enable();
            if !self.live().syncing {
                return;
            }
            ended.await;
        }
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

    /// Point the device at a new URL or token and save it; library and sync token stay.
    /// Turned away while a sync runs.
    pub async fn retarget(&self, to: Retarget) -> Result<Retargeted, ControlError> {
        let retargeted = {
            let mut live = self.live();
            if live.syncing {
                return Err(ControlError::SyncInProgress);
            }
            match to {
                Retarget::Url(url) => {
                    live.saved.url = Some(url.clone());
                    live.url = url;
                }
                Retarget::Token(token) => {
                    live.saved.token = token;
                    live.saved.wired_url = None;
                }
                Retarget::Wired { token, url } => {
                    live.saved.token = token;
                    live.saved.wired_url = Some(url);
                }
            }
            let needs_wire = !live.saved.token_wired_for(&live.url);
            Retargeted {
                view: live.view(),
                needs_wire,
            }
        };
        self.persist().await?;
        Ok(retargeted)
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

impl Live {
    /// How a sync ends before any request when the token was auto-wired for another server.
    fn refusal(&self) -> Option<LastSync> {
        let wired_url = self.saved.wired_url.as_deref()?;
        if self.saved.token_wired_for(&self.url) {
            return None;
        }
        Some(LastSync::Failed {
            quirk: None,
            message: format!(
                "the device token was auto-wired for {wired_url}, not {}: press w to wire one \
                 for this server, or give one with t / --token",
                self.url
            ),
        })
    }

    /// The device as `GET /device` reports it.
    fn view(&self) -> DeviceView {
        DeviceView {
            hardware_id: self.saved.device.hardware_id.clone(),
            url: self.url.clone(),
            syncing: self.syncing,
            last_sync: self.last_sync.clone(),
            sync_token: self.saved.device.sync_token.clone(),
            library: self.saved.device.library.clone(),
        }
    }
}

/// What `begin_sync` decided: a sync to run, or how a sync ended before it began.
enum Begun {
    Run(SyncingGuard, Device, String),
    Refused(LastSync),
}

/// Clears `syncing` when a sync ends for any reason, including its task panicking.
struct SyncingGuard(Arc<Control>);

impl Drop for SyncingGuard {
    fn drop(&mut self) {
        self.0.live().syncing = false;
        self.0.sync_ended.notify_waiters();
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
