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
    /// The `library_sync` pages fetched.
    pub pages: usize,
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
    /// The server answered a request no firmware quirk names with a non-2xx status.
    #[error("sync failed: {0}")]
    Rejected(String),
    /// The request got no answer at all.
    #[error("sync failed: no answer from the server: {0}")]
    Transport(String),
    /// The device's token is auto-wired for another server; refused before any request.
    #[error("{0}")]
    Refused(String),
}

/// One exchange with the server whatever its outcome: every request made, and how it ended.
#[derive(Debug)]
pub struct Attempt<T> {
    /// Every request the device made, in order, token redacted.
    pub requests: Vec<RequestRecord>,
    pub outcome: Result<T, SyncFailure>,
}

/// Press "Sync now" on `device`, configured with `api_endpoint`.
pub async fn sync_now(device: &mut Device, api_endpoint: &str) -> Result<SyncReport, SyncFailure> {
    let attempt = attempt_sync(device, api_endpoint).await;
    attempt.outcome.map(|pages| SyncReport {
        requests: attempt.requests,
        pages,
    })
}

/// Press "Sync now", keeping the request log even when the sync fails.
pub async fn attempt_sync(device: &mut Device, api_endpoint: &str) -> Attempt<usize> {
    let mut client = match Client::new(api_endpoint, &device.hardware_id) {
        Ok(client) => client,
        Err(failure) => {
            return Attempt {
                requests: Vec::new(),
                outcome: Err(failure),
            }
        }
    };
    let outcome = run_sync(&mut client, device).await;
    Attempt {
        requests: client.into_requests(),
        outcome,
    }
}

/// The handshake, store paths and library sync; returns the pages fetched.
async fn run_sync(client: &mut Client, device: &mut Device) -> Result<usize, SyncFailure> {
    let initialization = client.initialization().await?;
    require_not_rejected(client, &initialization)?;
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
    require_success(client, &tests, Quirk::GetTestsPost)?;
    for path in STORE_PATHS {
        let store = client.store_path(path).await?;
        require_success(client, &store, Quirk::StorePaths)?;
    }
    sync_library(client, &resources.library_sync, device).await
}

/// Fetch and apply `library_sync` pages until the server stops asking for more,
/// returning how many it took. Each page's `x-kobo-synctoken` is kept on the
/// device once that page's items are applied, and echoed on the next request.
async fn sync_library(
    client: &mut Client,
    url: &str,
    device: &mut Device,
) -> Result<usize, SyncFailure> {
    for fetched in 1..=MAX_SYNC_PAGES {
        let page = client
            .library_sync(url, device.sync_token.as_deref())
            .await?;
        require_not_rejected(client, &page)?;
        let headers = page.headers();
        let more = headers
            .get(SYNC_CONTINUE_HEADER)
            .is_some_and(|v| v == "continue");
        let page_token = headers
            .get(SYNC_TOKEN_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        for item in client.decode::<Vec<SyncItem>>(page).await? {
            device.apply(item);
        }
        if page_token.is_some() {
            device.sync_token = page_token;
        }
        if !more {
            return Ok(fetched);
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
    Err(tripped(quirk, rejection(client, response)))
}

/// A non-2xx answer fails the sync even where no firmware quirk names the request.
fn require_not_rejected(client: &Client, response: &reqwest::Response) -> Result<(), SyncFailure> {
    if response.status().is_success() {
        return Ok(());
    }
    Err(SyncFailure::Rejected(rejection(client, response)))
}

/// What a non-2xx answer says, safe to report.
fn rejection(client: &Client, response: &reqwest::Response) -> String {
    let path = client.redact(response.url().path());
    format!("{path} answered {}", response.status())
}

fn tripped(quirk: Quirk, detail: impl Into<String>) -> SyncFailure {
    SyncFailure::Quirk {
        quirk,
        detail: detail.into(),
    }
}

#[cfg(test)]
mod tests;
