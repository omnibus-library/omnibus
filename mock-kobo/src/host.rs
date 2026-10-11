//! One long-running fake Kobo: the device and its state file, the server it
//! syncs against, and what its last sync did. Every front end — the control
//! API now — drives the device through this.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::client::RequestRecord;
use crate::config::Server;
use crate::device::Book;
use crate::session::run_sync;
use crate::store::{DeviceStore, StoreError};

/// How the last sync ended, as the device would show it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LastSync {
    pub ok: bool,
    /// The pages synced, or the failure the device shows, token redacted.
    pub message: String,
}

/// The device as a front end shows it; never the token, the device's only credential.
#[derive(Debug, Serialize)]
pub struct DeviceView<'a> {
    pub hardware_id: &'a str,
    pub url: &'a str,
    pub sync_token: Option<&'a str>,
    pub library: &'a BTreeMap<String, Book>,
    pub last_sync: Option<&'a LastSync>,
}

/// One device and what its last sync did.
pub struct DeviceHost {
    store: DeviceStore,
    server: Server,
    last_sync: Option<LastSync>,
    requests: Vec<RequestRecord>,
}

impl DeviceHost {
    /// The device kept in `store`, syncing against `server`.
    pub fn new(store: DeviceStore, server: Server) -> Self {
        Self {
            store,
            server,
            last_sync: None,
            requests: Vec::new(),
        }
    }

    /// Press "Sync now", keep how it went, and save what the device now holds.
    /// A failed sync is a [`LastSync`], not an error: only saving can fail.
    pub async fn sync(&mut self) -> Result<LastSync, StoreError> {
        let endpoint = self.server.api_endpoint();
        let run = run_sync(&mut self.store.state_mut().device, &endpoint).await;
        let last = match run.result {
            Ok(pages) => LastSync {
                ok: true,
                message: format!("synced {pages} library_sync page(s)"),
            },
            Err(failure) => LastSync {
                ok: false,
                message: failure.to_string(),
            },
        };
        self.requests = run.requests;
        self.last_sync = Some(last.clone());
        self.store.save()?;
        Ok(last)
    }

    /// Wipe the library and sync token, forget the last sync, and save.
    pub fn reset(&mut self) -> Result<(), StoreError> {
        self.last_sync = None;
        self.requests.clear();
        self.store.reset()
    }

    /// The last sync's requests, token redacted.
    pub fn requests(&self) -> &[RequestRecord] {
        &self.requests
    }

    /// The device as a front end shows it.
    pub fn view(&self) -> DeviceView<'_> {
        let device = &self.store.state().device;
        DeviceView {
            hardware_id: &device.hardware_id,
            url: &self.server.url,
            sync_token: device.sync_token.as_deref(),
            library: &device.library,
            last_sync: self.last_sync.as_ref(),
        }
    }
}
