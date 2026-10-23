//! One running device: the state the control API reads and drives.
//! A sync runs on its own task, so a caller that disconnects never cancels it
//! half-way. A reset clears what the device holds and its sync token, so the
//! next sync gets every book again. A retarget changes the URL or token between
//! syncs; a sync reads both under one lock, so it never mixes two targets, and
//! never sends a token auto-wired for another URL.

use std::collections::BTreeMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::client::RequestRecord;
use crate::device::{Book, Device, DeviceError};
use crate::downloads::DownloadPolicy;
use crate::firmware::Quirk;
use crate::session::{attempt_sync, Attempt, SyncFailure};
use crate::state::{self, SavedState, StateError};

pub mod actions;

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

/// What `PUT /reset` tells the caller about the next sync.
pub const RESET_MESSAGE: &str = "device reset; the next sync sends every opted-in book again";

/// Why the control API couldn't do what it was asked.
#[derive(Debug, thiserror::Error)]
pub enum ControlError {
    #[error("a sync is already running")]
    SyncInProgress,
    #[error("device state not saved: {0}")]
    StateNotSaved(#[from] StateError),
    #[error(transparent)]
    Device(#[from] DeviceError),
}

/// How a device action that talks to the server ended.
#[derive(Clone, Debug, PartialEq)]
pub enum Acted {
    Done(DeviceView),
    Failed {
        quirk: Option<Quirk>,
        message: String,
    },
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
    /// A sync, download or reading-state write is talking to the server.
    /// Kobo calls all of them syncing, so there is no separate name per kind.
    pub syncing: bool,
    pub last_sync: Option<LastSync>,
    pub sync_token: Option<String>,
    pub library: BTreeMap<String, Book>,
}

impl Control {
    /// A device restored from (or just written to) `state_path`, syncing
    /// against `url`. Its storage directory sits beside the state file,
    /// whatever `saved` carried in (storage is never saved to disk).
    pub fn new(mut saved: SavedState, url: String, state_path: PathBuf) -> Self {
        saved.device.storage = Some(state::books_dir(&state_path));
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
    pub async fn sync(self: &Arc<Self>, policy: DownloadPolicy) -> Result<LastSync, ControlError> {
        let attempt = self
            .run_exchange(
                |mut device, endpoint| async move {
                    let attempt = attempt_sync(&mut device, &endpoint, &policy).await;
                    (device, attempt)
                },
                // Only `sync` writes `last_sync`, including for a refusal; a
                // download or state write leaves it alone. Runs inside the
                // exchange's own task, so a dropped caller never loses it.
                |live, attempt| live.last_sync = Some(last_sync_of(attempt)),
            )
            .await?;
        Ok(last_sync_of(&attempt))
    }

    /// Mark one exchange with the server as running (the busy flag) and hand
    /// back the device it works on and its endpoint, or turn it away before
    /// any request: a sync already running, or a token auto-wired for
    /// another server. The endpoint is read with the flag, so a retarget
    /// never lands between them.
    fn begin_exchange(self: &Arc<Self>) -> Result<Begun, ControlError> {
        let mut live = self.live();
        if live.syncing {
            return Err(ControlError::SyncInProgress);
        }
        if let Some(message) = live.refusal() {
            return Ok(Begun::Refused(message));
        }
        live.syncing = true;
        let endpoint = format!("{}/kobo/{}", live.url, live.saved.token);
        let device = live.saved.device.clone();
        drop(live);
        Ok(Begun::Run(SyncingGuard(Arc::clone(self)), device, endpoint))
    }

    /// Run one exchange with the server through `op`, which is given a
    /// device clone and its endpoint and hands back the device as it ended
    /// plus what happened. Commits that device, appends its requests to the
    /// log, runs `on_done` (for the caller's own fields, e.g. `last_sync`),
    /// and saves — the one thing every exchange with the server does — on
    /// its own task, so a dropped caller never cancels any of it. A refusal
    /// before any request skips the request and the save, but still runs
    /// `on_done`. The `live` lock is never held across an `.await`.
    async fn run_exchange<T, F, Fut>(
        self: &Arc<Self>,
        op: F,
        on_done: impl FnOnce(&mut Live, &Attempt<T>) + Send + 'static,
    ) -> Result<Attempt<T>, ControlError>
    where
        T: Send + 'static,
        F: FnOnce(Device, String) -> Fut + Send + 'static,
        Fut: Future<Output = (Device, Attempt<T>)> + Send,
    {
        let (guard, device, endpoint) = match self.begin_exchange()? {
            Begun::Run(guard, device, endpoint) => (guard, device, endpoint),
            Begun::Refused(message) => {
                let attempt = Attempt {
                    requests: Vec::new(),
                    outcome: Err(SyncFailure::Refused(message)),
                };
                on_done(&mut self.live(), &attempt);
                return Ok(attempt);
            }
        };
        let control = Arc::clone(self);
        let task = tokio::spawn(async move {
            let _guard = guard;
            let (device, attempt) = op(device, endpoint).await;
            {
                let mut live = control.live();
                live.saved.device = device;
                live.requests.extend(attempt.requests.clone());
                on_done(&mut live, &attempt);
            }
            let persisted = control.persist().await;
            (attempt, persisted)
        });
        let (attempt, persisted) = match task.await {
            Ok(result) => result,
            Err(error) => std::panic::resume_unwind(
                error
                    .try_into_panic()
                    .unwrap_or_else(|cancelled| Box::new(cancelled.to_string())),
            ),
        };
        persisted?;
        Ok(attempt)
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

    /// Wipe what the device holds — its library, sync token and cover cache
    /// — by replacing it outright; keep who it is and where it syncs.
    pub async fn reset(&self) -> Result<DeviceView, ControlError> {
        {
            let mut live = self.live();
            if live.syncing {
                return Err(ControlError::SyncInProgress);
            }
            let hardware_id = live.saved.device.hardware_id.clone();
            live.saved.device = Device::new(&hardware_id);
            live.saved.device.storage = Some(state::books_dir(&self.state_path));
            live.last_sync = None;
            live.requests.clear();
        }
        self.persist().await?;
        Ok(self.view())
    }

    /// Point the device at a new URL or token and save it. A URL retarget
    /// keeps everything; a token retarget keeps the library but drops the
    /// sync token and cached download URLs, so the next sync is a full
    /// resync that re-delivers every held book with URLs carrying the new
    /// token. Every arm also drops `reading_services_host`: it was learned
    /// from the old target's `v1/initialization`, so a highlight or a
    /// post-download annotations GET made before the next sync must not
    /// reach whichever server that was. Turned away while a sync runs.
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
                    live.saved.device.forget_server(false);
                }
                Retarget::Token(token) => {
                    live.saved.token = token;
                    live.saved.wired_url = None;
                    live.saved.device.forget_server(true);
                }
                Retarget::Wired { token, url } => {
                    live.saved.token = token;
                    live.saved.wired_url = Some(url);
                    live.saved.device.forget_server(true);
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
    /// Why an exchange ends before any request when the token was auto-wired for another server.
    fn refusal(&self) -> Option<String> {
        let wired_url = self.saved.wired_url.as_deref()?;
        if self.saved.token_wired_for(&self.url) {
            return None;
        }
        Some(format!(
            "the device token was auto-wired for {wired_url}, not {}: press w to wire one \
             for this server, or give one with t / --token",
            self.url
        ))
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

/// What `begin_exchange` decided: an exchange to run, or a refusal before any request.
enum Begun {
    Run(SyncingGuard, Device, String),
    Refused(String),
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

/// How a sync's outcome shows up as `GET /device`'s `last_sync`.
fn last_sync_of(attempt: &Attempt<usize>) -> LastSync {
    match &attempt.outcome {
        Ok(pages) => LastSync::Synced { pages: *pages },
        Err(failure) => LastSync::Failed {
            quirk: quirk_of(failure),
            message: failure.to_string(),
        },
    }
}

/// How a download or state-write action's outcome is reported to its caller.
fn acted(attempt: Attempt<()>, view: DeviceView) -> Acted {
    match attempt.outcome {
        Ok(()) => Acted::Done(view),
        Err(failure) => Acted::Failed {
            quirk: quirk_of(&failure),
            message: failure.to_string(),
        },
    }
}

#[cfg(test)]
mod tests;
