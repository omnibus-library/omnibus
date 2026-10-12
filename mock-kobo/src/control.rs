//! One running device: the state the control API reads and drives.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::device::Book;
use crate::firmware::Quirk;
use crate::state::SavedState;

/// One running device: what the control API (and a TUI) reads and drives.
pub struct Control {
    url: String,
    live: Mutex<Live>,
}

/// The parts of a running device that change.
struct Live {
    saved: SavedState,
    syncing: bool,
    last_sync: Option<LastSync>,
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
    pub fn new(saved: SavedState, url: String, _state_path: PathBuf) -> Self {
        Self {
            url,
            live: Mutex::new(Live {
                saved,
                syncing: false,
                last_sync: None,
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

    /// The lock on the live state; a panic elsewhere never makes the device unreadable.
    fn live(&self) -> MutexGuard<'_, Live> {
        self.live.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
