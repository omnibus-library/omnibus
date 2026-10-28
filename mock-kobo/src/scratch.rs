//! The scratch state directory `mock-kobo tui` runs on when no state file is
//! named, so every launch starts as a new device. Each run holds an exclusive
//! lock on `<dir>/lock` and removes the dir on drop; [`sweep`] clears the dirs
//! of runs that were killed, which can't clean up after themselves.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

const LOCK: &str = "lock";
const STATE_FILE: &str = "mock-kobo.json";

/// The directory holding every run's scratch dir.
pub fn root() -> PathBuf {
    std::env::temp_dir().join("omnibus-mock-kobo")
}

/// One run's scratch dir, removed when this is dropped.
pub struct Scratch {
    dir: tempfile::TempDir,
    _lock: File,
}

impl Scratch {
    /// A new dir under `root` (made if missing), locked for the life of the value.
    pub fn create(root: &Path) -> io::Result<Scratch> {
        fs::create_dir_all(root)?;
        let dir = tempfile::Builder::new().prefix("run.").tempdir_in(root)?;
        let lock = File::create(dir.path().join(LOCK))?;
        lock.try_lock().map_err(io::Error::from)?;
        Ok(Scratch { dir, _lock: lock })
    }

    /// The state file this run's device saves to; its `.books/` sibling lands beside it.
    pub fn state_path(&self) -> PathBuf {
        self.dir.path().join(STATE_FILE)
    }
}

/// Remove every dir under `root` that no live run holds. Never fails: what can't
/// be read or removed is left for the next launch.
pub fn sweep(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        // Only `Ok` proves the run is dead; a dir with no lock yet is a run still starting.
        let Ok(lock) = File::open(dir.join(LOCK)) else {
            continue;
        };
        if lock.try_lock().is_ok() {
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

#[cfg(test)]
mod tests;
