//! A device's state file: everything a real Kobo keeps on disk across restarts.
//! Synced to disk in a temp file, renamed into place, and its directory synced,
//! so neither a crash nor a power loss leaves a half-written file or undoes a
//! saved one. Owner-only: it holds the device token.

use std::fs::OpenOptions;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::device::Device;

/// Everything one device keeps across restarts: what a real Kobo stores on disk.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedState {
    /// The origin given by `--url`, env, or the TUI; `None` follows this worktree's dev server.
    pub url: Option<String>,
    /// The device's path token, its only credential.
    pub token: String,
    /// The origin an auto-wired token was minted against; `None` for a token the user gave.
    #[serde(default)]
    pub wired_url: Option<String>,
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

/// Write `state` to `path` atomically: a synced temp file beside it, then a rename.
/// The whole write runs as one blocking task, so a cancelled caller never leaves it half-run.
pub async fn save(path: &Path, state: &SavedState) -> Result<(), StateError> {
    let write_error = |source| StateError::Write {
        path: path.to_owned(),
        source,
    };
    let json = serde_json::to_vec_pretty(state).map_err(|error| write_error(error.into()))?;
    let target = path.to_owned();
    tokio::task::spawn_blocking(move || write_atomically(&target, &json))
        .await
        .map_err(|error| write_error(std::io::Error::other(error)))?
        .map_err(write_error)
}

/// `path`'s parent directory, or `None` for a bare file name.
fn parent_dir(path: &Path) -> Option<&Path> {
    path.parent().filter(|p| !p.as_os_str().is_empty())
}

/// Create `path`'s parent, write `json` to a temp file beside it, rename that over `path`,
/// and sync the parent so the rename survives a power loss.
fn write_atomically(path: &Path, json: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = parent_dir(path) {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = temp_path(path).ok_or(std::io::ErrorKind::InvalidInput)?;
    let written = write_synced(&tmp, json).and_then(|()| std::fs::rename(&tmp, path));
    if written.is_err() {
        // Best effort: the write's own error is the one worth reporting.
        let _ = std::fs::remove_file(&tmp);
    }
    written?;
    sync_parent(path)
}

/// Flush the rename onto disk: it is recorded in the parent directory, not in the file.
#[cfg(unix)]
fn sync_parent(path: &Path) -> std::io::Result<()> {
    let parent = parent_dir(path).unwrap_or(Path::new("."));
    std::fs::File::open(parent)?.sync_all()
}

/// Windows has no way to sync a directory.
#[cfg(not(unix))]
fn sync_parent(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Write `json` to a new file at `path`, owner-only, and flush it to disk.
fn write_synced(path: &Path, json: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path)?;
    file.write_all(json)?;
    file.sync_all()
}

/// A temp path in the same directory as `path` (so the rename never crosses a
/// filesystem), unique to this process and write so concurrent saves never share one.
fn temp_path(path: &Path) -> Option<PathBuf> {
    static WRITES: AtomicU64 = AtomicU64::new(0);
    let write = WRITES.fetch_add(1, Ordering::Relaxed);
    let mut name = path.file_name()?.to_owned();
    name.push(format!(".{}.{write}.tmp", std::process::id()));
    Some(path.with_file_name(name))
}

#[cfg(test)]
mod tests;
