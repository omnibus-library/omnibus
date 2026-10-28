//! The scratch state directory `mock-kobo tui` runs on when no state file is
//! named, so every launch starts as a new device. Each run holds an exclusive
//! lock on `<dir>/lock` and removes the dir on drop; [`sweep`] clears the dirs
//! of runs that were killed, which can't clean up after themselves. The root sits
//! inside the worktree's gitignored runtime dir, not `$TMPDIR`: a dev shell gives
//! every launch a new `$TMPDIR`, so a sweep there would never meet a dead run.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::cli::RUNTIME_DIR;

const LOCK: &str = "lock";
/// How long a dir with no lock file may sit before it is taken for abandoned.
const LOCKLESS_GRACE: Duration = Duration::from_secs(60);
const STATE_FILE: &str = "mock-kobo.json";

/// The directory holding every run's scratch dir, relative to the repo root as `just` runs from.
pub fn root() -> PathBuf {
    Path::new(RUNTIME_DIR).join("mock-kobo/runs")
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
        // Locked before it is named `lock`, so a sweep never meets the file unlocked.
        let pending = dir.path().join("lock.tmp");
        let lock = File::create(&pending)?;
        lock.try_lock().map_err(io::Error::from)?;
        fs::rename(&pending, dir.path().join(LOCK))?;
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
        // Only `Ok` proves the run is dead; a young dir with no lock is a run still starting.
        let dead = match File::open(dir.join(LOCK)) {
            Ok(lock) => lock.try_lock().is_ok(),
            Err(_) => is_old(&dir),
        };
        if dead {
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

/// Whether `dir` was last changed longer ago than a launch takes to lock its dir.
/// A run that has dropped can leave one behind: a download in flight recreates its dir.
fn is_old(dir: &Path) -> bool {
    fs::metadata(dir)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|elapsed| elapsed > LOCKLESS_GRACE)
}

#[cfg(test)]
mod tests;
