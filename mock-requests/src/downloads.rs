//! The mock's in-memory state, shared by every fake behind one lock: the releases the
//! catalogue has made (by id, which is how a client finds one it was handed a link to),
//! the downloads clients were given, and what the control API says to do with them.
//! Progress is worked out when a client reads it, from the clock the caller passes in, so
//! nothing runs on a timer. The read that sees a download finish copies its payload from
//! `test_data/` into the downloads folder. Nothing taken from a request ever becomes a
//! path: folders are named from generated ids. Nothing survives a restart.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use omnibus_shared::DownloadClientKind;
use serde::{Deserialize, Serialize};

use crate::catalogue::{magnet_hash, Payloads, Release};
use crate::nzb::{job_name_ok, release_id};

/// What the fake Prowlarr answers a search with.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    /// The catalogue's releases.
    #[default]
    Results,
    /// An empty list, which the server reads as "not found".
    Empty,
    /// An HTTP 500, which the server reads as "search failed".
    Fail,
}

/// How a download goes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// Progress runs to the end and the payload lands.
    #[default]
    Complete,
    /// Progress freezes where it is.
    Stall,
    /// The client reports the download as errored.
    Fail,
    /// Progress runs to the end but the folder holds only a README, which cannot be imported.
    Junk,
}

/// One download a fake client holds.
pub struct Download {
    /// A torrent's info hash, or a usenet job's name.
    pub id: String,
    /// SABnzbd's and NZBGet's numeric job id.
    pub num: u64,
    /// The fake it was given to.
    pub client: DownloadClientKind,
    /// What it is a download of.
    pub release: Release,
    /// The one folder under the downloads root the files land in.
    pub folder: String,
    /// When it was added, in Unix seconds.
    pub added: i64,
    /// How this download goes.
    pub outcome: Outcome,
    progress: f64,
    last: Instant,
    /// The payload has been written; the download is over.
    pub done: bool,
}

impl Download {
    /// 0.0 to 1.0.
    pub fn progress(&self) -> f64 {
        self.progress
    }

    /// Whole seconds left of a download that takes `secs`, as a client would estimate them;
    /// `None` once it is over, and for one that is stalled or failed.
    pub fn eta(&self, secs: u64) -> Option<i64> {
        self.running()
            .then(|| ((1.0 - self.progress) * secs as f64).ceil() as i64)
    }

    /// The payload file's name, such as `mock-<release id>.epub`.
    pub fn file_name(&self) -> String {
        format!(
            "mock-{}.{}",
            self.release.id,
            self.release.format.extension()
        )
    }

    /// The download is over, finished or failed, which usenet clients list in history.
    pub fn ended(&self) -> bool {
        self.done || self.outcome == Outcome::Fail
    }

    fn running(&self) -> bool {
        !self.done && matches!(self.outcome, Outcome::Complete | Outcome::Junk)
    }

    /// Bank the time since the last read at the rate the current outcome allows, for a
    /// download that takes `secs`.
    fn advance(&mut self, now: Instant, secs: u64) {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        if self.running() {
            self.progress = if secs == 0 {
                1.0
            } else {
                (self.progress + elapsed / secs as f64).min(1.0)
            };
        }
    }
}

/// Every fake's state; see the module doc.
pub struct Store {
    started: u64,
    counter: u64,
    next_num: u64,
    releases: HashMap<String, Release>,
    downloads: Vec<Download>,
    root: PathBuf,
    payloads: Payloads,
    /// What a search answers.
    pub search: SearchMode,
    /// What later downloads do, and the seconds they take.
    pub outcome: Outcome,
    /// Seconds a download takes to run its course.
    pub secs: u64,
}

impl Store {
    /// An empty store whose downloads land under `root` and take `secs` seconds.
    pub fn new(root: PathBuf, payloads: Payloads, secs: u64) -> Self {
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos() as u64);
        Self {
            started,
            counter: 0,
            next_num: 0,
            releases: HashMap::new(),
            downloads: Vec::new(),
            root,
            payloads,
            search: SearchMode::default(),
            outcome: Outcome::default(),
            secs,
        }
    }

    /// The folder finished downloads are written under.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// A fresh release id: 40 lowercase hex, unique across mock restarts because it leads
    /// with the start time, so a new release never reuses an old request's hash.
    pub fn mint(&mut self) -> String {
        self.counter += 1;
        format!("{:016x}{:024x}", self.started, self.counter)
    }

    /// Keep `release`, so a client handed its link can find it by id.
    pub fn remember(&mut self, release: Release) {
        self.releases.insert(release.id.clone(), release);
    }

    /// The release with this id, if a search made it.
    pub fn release(&self, id: &str) -> Option<&Release> {
        self.releases.get(id)
    }

    /// Start a download under `folder` and return its number. One `client` already holding
    /// `id` keeps it, so a retry finds the job it made.
    pub fn add(
        &mut self,
        client: DownloadClientKind,
        id: String,
        release: Release,
        folder: String,
        now: Instant,
    ) -> u64 {
        if let Some(held) = self.find(client, &id) {
            return held.num;
        }
        self.next_num += 1;
        let added = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        self.downloads.push(Download {
            id,
            num: self.next_num,
            client,
            release,
            folder,
            added,
            outcome: self.outcome,
            progress: 0.0,
            last: now,
            done: false,
        });
        self.next_num
    }

    /// The download `client` holds under `id`.
    pub fn find(&self, client: DownloadClientKind, id: &str) -> Option<&Download> {
        self.downloads
            .iter()
            .find(|d| d.client == client && d.id == id)
    }

    /// Every download `client` holds, oldest first.
    pub fn of(&self, client: DownloadClientKind) -> impl Iterator<Item = &Download> {
        self.downloads.iter().filter(move |d| d.client == client)
    }

    /// Every download, of every client.
    pub fn all(&self) -> &[Download] {
        &self.downloads
    }

    /// Bring every download up to `now`, writing the payload of any that just finished.
    pub fn refresh(&mut self, now: Instant) {
        for d in &mut self.downloads {
            d.advance(now, self.secs);
            if d.running() && d.progress >= 1.0 {
                match deliver(&self.root, &self.payloads, d) {
                    Ok(()) => d.done = true,
                    Err(e) => {
                        eprintln!("cannot write {}: {e}", d.folder);
                        d.outcome = Outcome::Fail;
                    }
                }
            }
        }
    }

    /// Change what later downloads do, and what every unfinished one does from `now`.
    pub fn set(&mut self, outcome: Option<Outcome>, secs: Option<u64>, now: Instant) {
        self.refresh(now);
        self.outcome = outcome.unwrap_or(self.outcome);
        self.secs = secs.unwrap_or(self.secs);
        for d in self.downloads.iter_mut().filter(|d| !d.done) {
            d.outcome = self.outcome;
        }
    }

    /// The names and sizes of the files in a download's folder; empty until it has one.
    pub fn files(&self, download: &Download) -> Vec<(String, u64)> {
        let Ok(entries) = fs::read_dir(self.root.join(&download.folder)) else {
            return Vec::new();
        };
        let mut files: Vec<(String, u64)> = entries
            .flatten()
            .filter_map(|e| Some((e.file_name().into_string().ok()?, e.metadata().ok()?.len())))
            .collect();
        files.sort();
        files
    }

    /// Start the torrent `magnet` names for `client` and return its id, or `None` when the
    /// mock never offered that release as a torrent.
    pub fn add_torrent(
        &mut self,
        client: DownloadClientKind,
        magnet: &str,
        now: Instant,
    ) -> Option<String> {
        let release = magnet_hash(magnet)
            .and_then(|hash| self.release(&hash).cloned())
            .filter(|r| r.protocol == client.protocol())?;
        let (id, folder) = (release.id.clone(), format!("mock-{}", release.id));
        self.add(client, id.clone(), release, folder, now);
        Some(id)
    }

    /// Start the job `name` for `client` from an uploaded `nzb` and return its number, or why
    /// the mock refused it. The name becomes a folder, so only the names Omnibus gives pass.
    pub fn add_usenet(
        &mut self,
        client: DownloadClientKind,
        name: &str,
        nzb: &[u8],
        now: Instant,
    ) -> Result<u64, &'static str> {
        if !job_name_ok(name) {
            return Err("the job name is not one Omnibus gives");
        }
        let release = release_id(nzb)
            .and_then(|id| self.release(&id).cloned())
            .filter(|r| r.protocol == client.protocol())
            .ok_or("this NZB is not one the mock offered")?;
        Ok(self.add(client, name.to_string(), release, name.to_string(), now))
    }

    /// Forget a download, and delete its folder when `delete_files`. Only the download's own
    /// folder is ever removed, never the downloads root.
    pub fn remove(&mut self, client: DownloadClientKind, id: &str, delete_files: bool) {
        let at = self
            .downloads
            .iter()
            .position(|d| d.client == client && d.id == id);
        self.drop_at(at, delete_files);
    }

    /// [`Self::remove`] for the download a usenet client numbered `num`.
    pub fn remove_num(&mut self, client: DownloadClientKind, num: u64, delete_files: bool) {
        let at = self
            .downloads
            .iter()
            .position(|d| d.client == client && d.num == num);
        self.drop_at(at, delete_files);
    }

    fn drop_at(&mut self, at: Option<usize>, delete_files: bool) {
        let Some(at) = at else {
            return;
        };
        let gone = self.downloads.remove(at);
        let mut parts = Path::new(&gone.folder).components();
        let one_name = matches!(
            (parts.next(), parts.next()),
            (Some(Component::Normal(_)), None)
        );
        if delete_files && one_name {
            let _ = fs::remove_dir_all(self.root.join(&gone.folder));
        }
    }
}

/// Write what a finished download holds. The payload is copied under the store lock, so a
/// large M4B blocks a worker.
// shortcut: the copy is synchronous; move it to spawn_blocking if it ever stalls the mock.
fn deliver(root: &Path, payloads: &Payloads, download: &Download) -> std::io::Result<()> {
    let dir = root.join(&download.folder);
    fs::create_dir_all(&dir)?;
    if download.outcome == Outcome::Junk {
        fs::write(
            dir.join("README.txt"),
            "This download holds nothing importable.\n",
        )
    } else {
        fs::copy(
            payloads.file(download.release.format),
            dir.join(download.file_name()),
        )
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests;
