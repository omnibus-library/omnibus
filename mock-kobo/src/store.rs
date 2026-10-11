//! The device's state file: everything a restart must bring back — the
//! device and the server it was last pointed at — as one JSON file the
//! long-running device loads at start and rewrites after every change.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::device::Device;

/// Everything a restart brings back.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedState {
    /// The server origin last given by flag or env; `None` follows the dev server.
    pub url: Option<String>,
    /// The device token last given by flag or env.
    pub token: Option<String>,
    pub device: Device,
}

/// One device's state file and what it holds.
#[derive(Debug)]
pub struct DeviceStore {
    path: PathBuf,
    state: SavedState,
}

/// Why the state file couldn't be used.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The file couldn't be read or written.
    #[error("state file {}: {source}", path.display())]
    Io { path: PathBuf, source: io::Error },
    /// The file holds something other than a saved device.
    #[error("state file {} is not a saved mock Kobo: {source}", path.display())]
    Corrupt {
        path: PathBuf,
        source: serde_json::Error,
    },
}

impl DeviceStore {
    /// The device saved at `path`, or a fresh one named by `new_hardware_id` when there is no file yet.
    pub fn open(
        path: impl Into<PathBuf>,
        new_hardware_id: impl FnOnce() -> String,
    ) -> Result<Self, StoreError> {
        let path = path.into();
        let state = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|source| StoreError::Corrupt {
                path: path.clone(),
                source,
            })?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => SavedState {
                url: None,
                token: None,
                device: Device::new(&new_hardware_id()),
            },
            Err(source) => return Err(StoreError::Io { path, source }),
        };
        Ok(Self { path, state })
    }

    /// What the device holds now, saved or not.
    pub fn state(&self) -> &SavedState {
        &self.state
    }

    /// The state to change; [`DeviceStore::save`] makes a change survive a restart.
    pub fn state_mut(&mut self) -> &mut SavedState {
        &mut self.state
    }

    /// Write the state, replacing the file in one step so a crash never leaves half of it.
    pub fn save(&self) -> Result<(), StoreError> {
        self.write().map_err(|source| StoreError::Io {
            path: self.path.clone(),
            source,
        })
    }

    /// Wipe the library and sync token, keep the hardware id and server settings, and save.
    pub fn reset(&mut self) -> Result<(), StoreError> {
        self.state.device = Device::new(&self.state.device.hardware_id);
        self.save()
    }

    fn write(&self) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut staged = OsString::from(&self.path);
        staged.push(".tmp");
        fs::write(&staged, serde_json::to_vec_pretty(&self.state)?)?;
        fs::rename(&staged, &self.path)
    }
}

#[cfg(test)]
mod tests;
