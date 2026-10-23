//! Downloads the way a sync takes them: a [`DownloadPolicy`] picks which
//! books to fetch; every undownloaded, non-archived book with a prior
//! problem is retried regardless of the policy
//! ([`crate::firmware::Quirk::DownloadFailure`]). A non-2xx answer, no
//! answer, or no URL at all leaves the book undownloaded with a redacted
//! problem and never fails the sync. When the device has storage
//! ([`crate::device::Device::storage`]), a successful download's body is
//! written there so the reader view can open it later; without storage the
//! body is drained and discarded, as a plain sync does.

use std::path::Path;

use tokio::io::AsyncWriteExt;

use crate::annotations;
use crate::client::Client;
use crate::device::Device;

/// Which books one sync downloads.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum DownloadPolicy {
    #[default]
    None,
    All,
    Listed(Vec<String>),
}

/// The books `policy` wants downloaded this sync: every book the policy
/// names that isn't downloaded or archived yet, plus every undownloaded,
/// non-archived book with a prior download problem, whatever the policy.
pub fn wanted(device: &Device, policy: &DownloadPolicy) -> Vec<String> {
    device
        .library
        .iter()
        .filter(|(_, book)| !book.archived && !book.downloaded)
        .filter(|(id, book)| policy_wants(policy, id) || book.download_problem.is_some())
        .map(|(id, _)| id.clone())
        .collect()
}

fn policy_wants(policy: &DownloadPolicy, id: &str) -> bool {
    match policy {
        DownloadPolicy::None => false,
        DownloadPolicy::All => true,
        DownloadPolicy::Listed(ids) => ids.iter().any(|listed| listed == id),
    }
}

/// Download every book `wanted` names, through the device's own
/// `download_urls`. Each successful download is followed by one
/// unconditional annotations GET before the next download starts
/// ([`crate::firmware::Quirk::AnnotationsOnDownload`]).
pub async fn download_books(client: &mut Client, device: &mut Device, policy: &DownloadPolicy) {
    for id in wanted(device, policy) {
        let outcome = attempt_one(client, device, &id).await;
        let downloaded = matches!(outcome, Outcome::Downloaded);
        apply_outcome(device, &id, outcome);
        if downloaded {
            annotations::fetch_after_download(client, device, &id).await;
        }
    }
}

/// What attempting one book's download found out.
pub enum Outcome {
    Downloaded,
    /// No `DownloadUrls` entry at all.
    NoUrl,
    /// A non-2xx answer, redacted.
    Rejected(String),
    /// No answer at all, redacted.
    Transport(String),
}

/// Fetch one book's bytes: streamed to storage when the device has one,
/// drained and discarded otherwise, as a plain sync does. Refused before
/// any request for an id that isn't a plain id ([`annotations::is_safe_id`]).
pub async fn attempt_one(client: &mut Client, device: &mut Device, id: &str) -> Outcome {
    let Some(url) = device.download_urls.get(id).cloned() else {
        return Outcome::NoUrl;
    };
    let storage = device.storage.clone();
    if storage.is_some() && !annotations::is_safe_id(id) {
        return Outcome::Rejected(format!("cannot store book {id:?}: not a plain id"));
    }
    match client.get(&url).await {
        Ok(mut response) if response.status().is_success() => match storage {
            Some(dir) => store(&mut response, &dir, id, client).await,
            None => match drain(&mut response).await {
                Ok(()) => Outcome::Downloaded,
                Err(error) => Outcome::Transport(client.redact(&error.to_string())),
            },
        },
        Ok(response) => Outcome::Rejected(format!(
            "{} answered {}",
            client.redact(response.url().path()),
            response.status()
        )),
        Err(failure) => Outcome::Transport(client.redact(&failure.to_string())),
    }
}

/// Stream `response`'s body into `dir/.{id}.part`, then rename it over
/// `dir/{id}.kepub.epub`. A write or rename failure removes the part file,
/// best-effort.
async fn store(response: &mut reqwest::Response, dir: &Path, id: &str, client: &Client) -> Outcome {
    if let Err(error) = tokio::fs::create_dir_all(dir).await {
        return Outcome::Rejected(client.redact(&error.to_string()));
    }
    let part = dir.join(format!(".{id}.part"));
    let target = dir.join(format!("{id}.kepub.epub"));
    match write_body(response, &part).await {
        Ok(()) => {
            if let Err(error) = tokio::fs::rename(&part, &target).await {
                let _ = tokio::fs::remove_file(&part).await;
                return Outcome::Rejected(client.redact(&error.to_string()));
            }
            // shortcut: a reset or remove-download never deletes `target`; harmless (a later
            // download overwrites it) — revisit if a reset should reclaim disk space.
            Outcome::Downloaded
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&part).await;
            match error {
                WriteError::Transport(error) => Outcome::Transport(client.redact(&error.to_string())),
                WriteError::Io(error) => Outcome::Rejected(client.redact(&error.to_string())),
            }
        }
    }
}

/// A body read that failed over the network, apart from one that failed
/// writing to disk — the caller maps the two to different outcomes
/// ([`Outcome::Transport`] is never the server's fault; [`Outcome::Rejected`] trips the quirk).
enum WriteError {
    Transport(reqwest::Error),
    Io(std::io::Error),
}

/// Write `response`'s body to a new file at `path`, chunk by chunk.
async fn write_body(response: &mut reqwest::Response, path: &Path) -> Result<(), WriteError> {
    let mut file = tokio::fs::File::create(path).await.map_err(WriteError::Io)?;
    while let Some(chunk) = response.chunk().await.map_err(WriteError::Transport)? {
        file.write_all(&chunk).await.map_err(WriteError::Io)?;
    }
    file.sync_all().await.map_err(WriteError::Io)
}

/// Record what `attempt_one` found out onto `id`'s book.
pub fn apply_outcome(device: &mut Device, id: &str, outcome: Outcome) {
    let Some(book) = device.library.get_mut(id) else {
        return;
    };
    match outcome {
        Outcome::Downloaded => {
            book.downloaded = true;
            book.download_problem = None;
        }
        Outcome::NoUrl => book.download_problem = Some("no download URL".to_owned()),
        Outcome::Rejected(problem) | Outcome::Transport(problem) => {
            book.download_problem = Some(problem);
        }
    }
}

/// Read a response body to its end without keeping any of it.
async fn drain(response: &mut reqwest::Response) -> Result<(), reqwest::Error> {
    while response.chunk().await?.is_some() {}
    Ok(())
}

#[cfg(test)]
mod tests;
