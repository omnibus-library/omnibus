//! Downloads the way a sync takes them: a [`DownloadPolicy`] picks which
//! books to fetch; every undownloaded, non-archived book with a prior
//! problem is retried regardless of the policy
//! ([`crate::firmware::Quirk::DownloadFailure`]). A non-2xx answer, no
//! answer, or no URL at all leaves the book undownloaded with a redacted
//! problem and never fails the sync.

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

/// Download every book `wanted` names, through the device's own `download_urls`.
pub async fn download_books(client: &mut Client, device: &mut Device, policy: &DownloadPolicy) {
    for id in wanted(device, policy) {
        download_one(client, device, &id).await;
    }
}

/// Fetch one book's bytes, draining the body chunk by chunk rather than
/// buffering it, and never storing it — this is a sync, not the reader.
async fn download_one(client: &mut Client, device: &mut Device, id: &str) {
    let Some(url) = device.download_urls.get(id).cloned() else {
        record_problem(device, id, "no download URL".to_owned());
        return;
    };
    match client.download(&url).await {
        Ok(mut response) if response.status().is_success() => match drain(&mut response).await {
            Ok(()) => {
                if let Some(book) = device.library.get_mut(id) {
                    book.downloaded = true;
                    book.download_problem = None;
                }
            }
            Err(error) => record_problem(device, id, client.redact(&error.to_string())),
        },
        Ok(response) => {
            let problem = format!(
                "{} answered {}",
                client.redact(response.url().path()),
                response.status()
            );
            record_problem(device, id, problem);
        }
        Err(failure) => record_problem(device, id, client.redact(&failure.to_string())),
    }
}

/// Read a response body to its end without keeping any of it.
async fn drain(response: &mut reqwest::Response) -> Result<(), reqwest::Error> {
    while response.chunk().await?.is_some() {}
    Ok(())
}

fn record_problem(device: &mut Device, id: &str, problem: String) {
    if let Some(book) = device.library.get_mut(id) {
        book.download_problem = Some(problem);
    }
}

#[cfg(test)]
mod tests;
