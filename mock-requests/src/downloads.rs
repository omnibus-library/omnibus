//! The mock's in-memory state, shared by every fake behind one lock: the releases the
//! catalogue has made (by id, which is how a client finds one it was handed a link to)
//! and what the fake Prowlarr answers searches with. Nothing survives a restart.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::catalogue::Release;

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

pub struct Store {
    started: u64,
    counter: u64,
    releases: HashMap<String, Release>,
    pub search: SearchMode,
}

impl Default for Store {
    fn default() -> Self {
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos() as u64);
        Self {
            started,
            counter: 0,
            releases: HashMap::new(),
            search: SearchMode::default(),
        }
    }
}

impl Store {
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

    pub fn release(&self, id: &str) -> Option<&Release> {
        self.releases.get(id)
    }
}

#[cfg(test)]
mod tests;
