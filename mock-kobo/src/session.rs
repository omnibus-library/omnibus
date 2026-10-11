//! One "Sync now" press, end to end: the handshake, the store paths, and the
//! library sync, run the way the firmware runs them.

use crate::client::{Client, RequestRecord};
use crate::device::Device;
use crate::firmware::{
    Quirk, API_TOKEN_HEADER, MAX_SYNC_PAGES, STORE_PATHS, SYNC_CONTINUE_HEADER, SYNC_TOKEN_HEADER,
};
use crate::wire::{Initialization, SyncItem};

/// What one successful sync did.
#[derive(Clone, Debug, PartialEq)]
pub struct SyncReport {
    /// Every request the device made, in order, token redacted.
    pub requests: Vec<RequestRecord>,
}

/// Why a sync failed: what the device would show as "Sync Failed".
#[derive(Debug, thiserror::Error)]
pub enum SyncFailure {
    /// A firmware rule tripped on the server's answer.
    #[error("sync failed ({quirk:?}): {detail}")]
    Quirk { quirk: Quirk, detail: String },
    /// The server answered with a body the device can't read.
    #[error("sync failed: unreadable response: {0}")]
    BadResponse(String),
    /// The request got no answer at all.
    #[error("sync failed: no answer from the server: {0}")]
    Transport(String),
}

/// Press "Sync now" on `device`, configured with `api_endpoint`.
pub async fn sync_now(device: &mut Device, api_endpoint: &str) -> Result<SyncReport, SyncFailure> {
    let mut client = Client::new(api_endpoint, &device.hardware_id);
    let initialization = client.initialization().await?;
    if !initialization.headers().contains_key(API_TOKEN_HEADER) {
        return Err(tripped(
            Quirk::ApiToken,
            "v1/initialization carried no x-kobo-apitoken",
        ));
    }
    let resources = client
        .decode::<Initialization>(initialization)
        .await?
        .resources;
    let tests = client.get_tests(&resources.get_tests_request).await?;
    require_success(&client, &tests, Quirk::GetTestsPost)?;
    for path in STORE_PATHS {
        let store = client.store_path(path).await?;
        require_success(&client, &store, Quirk::StorePaths)?;
    }
    sync_library(&mut client, &resources.library_sync, device).await?;
    Ok(SyncReport {
        requests: client.into_requests(),
    })
}

/// Fetch and apply `library_sync` pages until the server stops asking for more.
async fn sync_library(
    client: &mut Client,
    url: &str,
    device: &mut Device,
) -> Result<(), SyncFailure> {
    let mut sync_token = None;
    for _ in 0..MAX_SYNC_PAGES {
        let page = client.library_sync(url, sync_token.as_deref()).await?;
        let headers = page.headers();
        let more = headers
            .get(SYNC_CONTINUE_HEADER)
            .is_some_and(|v| v == "continue");
        sync_token = headers
            .get(SYNC_TOKEN_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        for item in client.decode::<Vec<SyncItem>>(page).await? {
            device.apply(item);
        }
        if !more {
            return Ok(());
        }
    }
    let detail = format!("library_sync still continuing after {MAX_SYNC_PAGES} pages");
    Err(tripped(Quirk::SyncPaging, detail))
}

/// Firmware aborts the whole sync on a non-2xx answer to these requests.
fn require_success(
    client: &Client,
    response: &reqwest::Response,
    quirk: Quirk,
) -> Result<(), SyncFailure> {
    if response.status().is_success() {
        return Ok(());
    }
    let path = client.redact(response.url().path());
    let detail = format!("{path} answered {}", response.status());
    Err(tripped(quirk, detail))
}

fn tripped(quirk: Quirk, detail: impl Into<String>) -> SyncFailure {
    SyncFailure::Quirk {
        quirk,
        detail: detail.into(),
    }
}

#[cfg(test)]
mod tests;
