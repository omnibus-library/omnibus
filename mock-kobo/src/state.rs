//! A device's state file: everything a real Kobo keeps on disk across restarts.
//! Written atomically so a crash mid-save never leaves a half-written file.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::device::Device;

/// Everything one device keeps across restarts: what a real Kobo stores on disk.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedState {
    /// The origin given by `--url`, env, or the TUI; `None` follows this worktree's dev server.
    pub url: Option<String>,
    /// The device's path token, its only credential.
    pub token: String,
    pub device: Device,
}

/// Why a state file couldn't be read or written.
#[derive(Debug, thiserror::Error)]
pub enum StateError {
    #[error("cannot read {}: {source}", path.display())]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{} is not a mock-kobo state file: {detail}", path.display())]
    Corrupt { path: PathBuf, detail: String },
    #[error("cannot write {}: {source}", path.display())]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

/// The saved state at `path`, or `None` when no file exists yet.
pub async fn load(path: &Path) -> Result<Option<SavedState>, StateError> {
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(StateError::Read {
                path: path.to_owned(),
                source,
            })
        }
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| StateError::Corrupt {
            path: path.to_owned(),
            detail: error.to_string(),
        })
}

/// Write `state` to `path` atomically: `<file name>.tmp` beside it, then rename.
pub async fn save(path: &Path, state: &SavedState) -> Result<(), StateError> {
    let write_error = |source| StateError::Write {
        path: path.to_owned(),
        source,
    };
    let json = serde_json::to_vec_pretty(state).map_err(|error| write_error(error.into()))?;
    let tmp =
        temp_path(path).ok_or_else(|| write_error(std::io::ErrorKind::InvalidInput.into()))?;
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(write_error)?;
    }
    tokio::fs::write(&tmp, json).await.map_err(write_error)?;
    tokio::fs::rename(&tmp, path).await.map_err(write_error)
}

/// `<file name>.tmp` in the same directory as `path`, so the rename never crosses a filesystem.
fn temp_path(path: &Path) -> Option<PathBuf> {
    let mut name = path.file_name()?.to_owned();
    name.push(".tmp");
    Some(path.with_file_name(name))
}

#[cfg(test)]
mod tests;
