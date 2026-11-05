//! Maps a path the download client reports into the folder the Omnibus server sees it
//! under, for when the two run in different containers with the same completed-downloads
//! folder mounted at different places. The result is canonical and checked to still sit
//! inside the local folder, so a client-supplied `..` or a symlink cannot point an import
//! at an arbitrary file on the server.

use std::path::{Path, PathBuf};

/// Why a client path could not be mapped to a local file.
#[derive(Debug, thiserror::Error)]
pub enum PathMapError {
    #[error("the path is not under the download client's folder")]
    NotUnderPrefix,
    #[error("the path resolves outside the download folder on this server")]
    Escapes,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// Swap `client_prefix` for `local_prefix` on `client` and return the canonical local path,
/// which must exist and stay inside `local_prefix`. Does blocking filesystem calls.
pub fn map_client_path(
    client: &Path,
    client_prefix: &Path,
    local_prefix: &Path,
) -> Result<PathBuf, PathMapError> {
    let relative = client
        .strip_prefix(client_prefix)
        .map_err(|_| PathMapError::NotUnderPrefix)?;
    let root = local_prefix.canonicalize()?;
    let resolved = local_prefix.join(relative).canonicalize()?;
    if !resolved.starts_with(&root) {
        return Err(PathMapError::Escapes);
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests;
