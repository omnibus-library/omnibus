//! Adds a finished download to the library, filed under the book that was asked for.
//! [`files`] decides which downloaded file is the book; [`place`] stages it inside the
//! library and renames it into the canonical layout.

use std::io;

use super::paths::PathMapError;
use super::store::RequestError;
use crate::merge::MergeError;

pub mod files;
pub mod place;

/// Why a finished download could not be added. Each message is for an admin: the reader
/// sees only "Couldn't add it".
#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("the download has no ebook file to add")]
    NothingImportable,
    #[error("the finished download is not visible to this server: {0}")]
    NotVisible(#[from] PathMapError),
    #[error("filing the download failed: {0}")]
    Io(#[from] io::Error),
    #[error("no ebook library is set up")]
    NoLibrary,
    #[error("the library scan did not take the file: {0}")]
    Scan(String),
    #[error("merging into the requested book failed: {0}")]
    Merge(#[from] MergeError),
    #[error(transparent)]
    Db(#[from] RequestError),
}

#[cfg(test)]
mod tests;
