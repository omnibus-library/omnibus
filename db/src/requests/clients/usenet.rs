//! What the usenet clients (SABnzbd, NZBGet) share. A usenet job has no info hash, so its id
//! is the SHA-1 of the release link, in the same 40 lowercase hex characters, and the client
//! is given the job under the name `omnibus-<id>`. The id is known before the client is
//! given the NZB (which its `add` fetches, not `prepare`), and the same link always gives
//! the same id, so a retry finds the job by its name. The client's own job id is never
//! stored: it is looked up by name when needed. The job folder is read from this server's
//! disk, since the clients list no files.

use std::fs;
use std::path::{Path, PathBuf};

use sha1::{Digest, Sha1};

use crate::requests::paths::{map_client_path, PathMapError};
use crate::requests::ConnectionError;

use super::release::{check_nzb_link, Release};
use super::{ClientFile, Prepared};

/// Folders deeper than this inside a job's folder are not read.
const MAX_DEPTH: usize = 8;

/// The id a usenet download is found by: the lowercase hex SHA-1 of `link`.
pub fn job_id(link: &str) -> String {
    data_encoding::HEXLOWER.encode(&Sha1::digest(link.as_bytes()))
}

/// The name the client is given the job under, which is how it is found there again.
pub fn job_name(id: &str) -> String {
    format!("omnibus-{id}")
}

/// A usenet job reports under this until its client has unpacked it, so a job that fails
/// while verifying, repairing or unpacking never looks finished to the poller.
pub const UNPACKING_PROGRESS: f64 = 0.99;

/// Work out the job's id from `link` without a request: the NZB is fetched only when the
/// client is given it, after the client is known to be reachable.
pub fn prepare(link: &str) -> Result<Prepared<Release>, ConnectionError> {
    check_nzb_link(link)?;
    Ok(Prepared {
        hash: job_id(link),
        release: Release::NzbLink(link.to_string()),
    })
}

/// Where the download client's completed-downloads folder is on this server.
#[derive(Default)]
pub struct JobFolders {
    client_prefix: Option<String>,
    local_prefix: Option<String>,
}

impl JobFolders {
    /// The folder as the client sees it, and as this server does. Unless both are set the
    /// client's own paths are read as they are.
    pub fn new(client_prefix: Option<&str>, local_prefix: Option<&str>) -> Self {
        Self {
            client_prefix: client_prefix.map(str::to_string),
            local_prefix: local_prefix.map(str::to_string),
        }
    }

    /// The files under the job folder `save_path` (as the client names it), relative to
    /// it. A folder that cannot be found or read lists nothing; the import, finding no file in
    /// a folder it cannot map, ends "not visible" once rather than retrying.
    pub async fn files(&self, save_path: &str) -> Vec<ClientFile> {
        let save_path = PathBuf::from(save_path);
        let (client, local) = (self.client_prefix.clone(), self.local_prefix.clone());
        tokio::task::spawn_blocking(move || list(&save_path, client.as_deref(), local.as_deref()))
            .await
            .map_err(|e| PathMapError::Io(std::io::Error::other(e)))
            .and_then(|listed| listed)
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "list a usenet job's folder");
                Vec::new()
            })
    }
}

/// [`JobFolders::files`], blocking.
fn list(
    save_path: &Path,
    client_prefix: Option<&str>,
    local_prefix: Option<&str>,
) -> Result<Vec<ClientFile>, PathMapError> {
    let dir = match (client_prefix, local_prefix) {
        (Some(client), Some(local)) => {
            map_client_path(save_path, Path::new(client), Path::new(local))?
        }
        _ => save_path.canonicalize()?,
    };
    let mut files = Vec::new();
    walk(&dir, &dir, 0, &mut files)?;
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Add the files under `dir` to `out`, named relative to `root`. A symlink is skipped, so a
/// job cannot list what lies outside its folder.
fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<ClientFile>,
) -> Result<(), std::io::Error> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let path = entry.path();
        if kind.is_file() {
            let name = path.strip_prefix(root).unwrap_or(&path);
            out.push(ClientFile {
                name: name.to_string_lossy().into_owned(),
                size: entry.metadata()?.len(),
            });
        } else if kind.is_dir() && depth < MAX_DEPTH {
            walk(root, &path, depth + 1, out)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
