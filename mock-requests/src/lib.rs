//! A fake Prowlarr and fake download clients for the book-request pipeline, all on one
//! port: their paths don't collide, so the server's request settings pick between
//! qBittorrent, Transmission, SABnzbd and NZBGet by kind alone. Searches are answered
//! from the query (see [`catalogue`]), and a control API under `/_mock` steers what the
//! fakes report. The fakes are tested through `omnibus-db`'s real clients.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use axum::Router;

pub mod catalogue;
pub mod cli;
pub mod control;
pub mod downloads;
pub mod prowlarr;
pub mod qbittorrent;
#[cfg(test)]
mod test_support;

use catalogue::Payloads;
use downloads::Store;

/// The API key the fake Prowlarr accepts.
pub const PROWLARR_API_KEY: &str = "mock-requests";

/// The login every fake client accepts, and what wiring saves.
pub const CLIENT_USERNAME: &str = "mock";

/// The password every fake client accepts, and SABnzbd's API key.
pub const CLIENT_PASSWORD: &str = "mock";

/// Everything the fakes share.
pub struct Mock {
    /// This mock's own address, such as `http://127.0.0.1:8123`, which usenet links point at.
    pub origin: String,
    store: Mutex<Store>,
}

pub type Shared = Arc<Mock>;

impl Mock {
    /// A mock whose downloads are written under `downloads` and take `download_secs`.
    pub fn new(
        origin: String,
        downloads: PathBuf,
        payloads: Payloads,
        download_secs: u64,
    ) -> Shared {
        Arc::new(Self {
            origin,
            store: Mutex::new(Store::new(downloads, payloads, download_secs)),
        })
    }

    /// The state, locked. A handler that panicked leaves it usable.
    pub fn store(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Every fake and the control API.
pub fn router(mock: Shared) -> Router {
    Router::new()
        .merge(prowlarr::routes())
        .merge(qbittorrent::routes())
        .merge(control::routes())
        .with_state(mock)
}
