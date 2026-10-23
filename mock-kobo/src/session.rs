//! One "Sync now" press, end to end: the handshake, the store paths, and the
//! library sync, run the way the firmware runs them.

use crate::client::{Client, RequestRecord};
use crate::covers;
use crate::device::Device;
use crate::downloads::{self, DownloadPolicy};
use crate::firmware::{
    Quirk, API_TOKEN_HEADER, MAX_SYNC_PAGES, STORE_PATHS, SYNC_CONTINUE_HEADER, SYNC_TOKEN_HEADER,
};
use crate::reading;
use crate::wire::{Initialization, StateResponse, SyncItem};

/// Which sub-objects a state PUT carries: a read sends status and bookmark, a finish status only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateSent {
    Read,
    Finish,
}

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
pub async fn sync_now(
    device: &mut Device,
    api_endpoint: &str,
    policy: &DownloadPolicy,
) -> Result<SyncReport, SyncFailure> {
    let attempt = attempt_sync(device, api_endpoint, policy).await;
    attempt.outcome.map(|pages| SyncReport {
        requests: attempt.requests,
        pages,
    })
}

/// Press "Sync now", keeping the request log even when the sync fails.
pub async fn attempt_sync(
    device: &mut Device,
    api_endpoint: &str,
    policy: &DownloadPolicy,
) -> Attempt<usize> {
    let mut client = match Client::new(api_endpoint, &device.hardware_id) {
        Ok(client) => client,
        Err(failure) => {
            return Attempt {
                requests: Vec::new(),
                outcome: Err(failure),
            }
        }
    };
    let outcome = run_sync(&mut client, device, policy).await;
    Attempt {
        requests: client.into_requests(),
        outcome,
    }
}

/// The handshake, store paths, library sync, covers and downloads; returns the pages fetched.
async fn run_sync(
    client: &mut Client,
    device: &mut Device,
    policy: &DownloadPolicy,
) -> Result<usize, SyncFailure> {
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
    let pages = sync_library(client, &resources.library_sync, device).await?;
    covers::fetch_covers(client, device, &resources.image_url_quality_template).await;
    downloads::download_books(client, device, policy).await;
    Ok(pages)
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

/// Download each of `books` not yet downloaded, recording a problem on any
/// that fail the way [`downloads::download_books`] does. Unlike a sync's own
/// download pass, a failure here surfaces in the outcome: `Transport` when
/// any book got no answer at all, else a [`Quirk::DownloadFailure`] naming
/// every book that answered non-2xx.
pub async fn attempt_download(
    device: &mut Device,
    api_endpoint: &str,
    books: &[String],
) -> Attempt<()> {
    let mut client = match Client::new(api_endpoint, &device.hardware_id) {
        Ok(client) => client,
        Err(failure) => {
            return Attempt {
                requests: Vec::new(),
                outcome: Err(failure),
            }
        }
    };
    let outcome = run_download(&mut client, device, books).await;
    Attempt {
        requests: client.into_requests(),
        outcome,
    }
}

async fn run_download(
    client: &mut Client,
    device: &mut Device,
    books: &[String],
) -> Result<(), SyncFailure> {
    let mut rejected = Vec::new();
    let mut transport = None;
    for id in books {
        if device
            .library
            .get(id.as_str())
            .is_some_and(|b| b.downloaded)
        {
            continue;
        }
        let outcome = downloads::attempt_one(client, device, id).await;
        if let downloads::Outcome::Transport(message) = &outcome {
            transport.get_or_insert_with(|| message.clone());
        }
        if matches!(
            outcome,
            downloads::Outcome::Rejected(_) | downloads::Outcome::NoUrl
        ) {
            rejected.push(id.clone());
        }
        downloads::apply_outcome(device, id, outcome);
    }
    if let Some(message) = transport {
        return Err(SyncFailure::Transport(message));
    }
    if !rejected.is_empty() {
        return Err(tripped(
            Quirk::DownloadFailure,
            format!("could not download: {}", rejected.join(", ")),
        ));
    }
    Ok(())
}

/// Send `book`'s current reading state to the server with one state PUT.
/// `device` must hold `book`; its own `Device::read`/`Device::finish` is
/// expected to have already set what this sends.
pub async fn attempt_state(
    device: &mut Device,
    api_endpoint: &str,
    book: &str,
    sent: StateSent,
) -> Attempt<()> {
    let mut client = match Client::new(api_endpoint, &device.hardware_id) {
        Ok(client) => client,
        Err(failure) => {
            return Attempt {
                requests: Vec::new(),
                outcome: Err(failure),
            }
        }
    };
    let outcome = run_state(&mut client, device, book, sent).await;
    Attempt {
        requests: client.into_requests(),
        outcome,
    }
}

async fn run_state(
    client: &mut Client,
    device: &Device,
    book: &str,
    sent: StateSent,
) -> Result<(), SyncFailure> {
    let Some(reading) = device.library.get(book).map(|b| b.reading.clone()) else {
        return Err(SyncFailure::BadResponse(format!(
            "no such book on device: {book}"
        )));
    };
    let body = reading::state_put_body(&reading, sent);
    let response = client.put_state(book, &body).await?;
    check_state_reply(client, response).await
}

/// A non-2xx answer rejects the sync as usual; a 2xx body that doesn't
/// parse as a [`StateResponse`] is a bad response; every sub-result reading
/// anything but `Success` trips [`Quirk::StatePutResult`].
async fn check_state_reply(
    client: &Client,
    response: reqwest::Response,
) -> Result<(), SyncFailure> {
    if !response.status().is_success() {
        return Err(SyncFailure::Rejected(rejection(client, &response)));
    }
    let state: StateResponse = client.decode(response).await?;
    let all_success = state.request_result == "Success"
        && state.update_results.iter().all(|u| {
            u.status_info_result.result == "Success"
                && u.current_bookmark_result.result == "Success"
        });
    if all_success {
        Ok(())
    } else {
        Err(tripped(
            Quirk::StatePutResult,
            format!(
                "state PUT returned a non-success result: {}",
                state.request_result
            ),
        ))
    }
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
