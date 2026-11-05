//! Which of a finished download's files is the book. [`resolve`] maps the client's list of
//! files onto this server's disk, refusing any that lead outside the download folder, and
//! [`pick`] keeps the ones whose bytes really are an EPUB or PDF.

use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use omnibus_shared::{detect_ebook_format, EBOOK_MAGIC_LEN};

use crate::requests::clients::{ClientFile, TorrentStatus};
use crate::requests::paths::{map_client_path, PathMapError};
use crate::settings::RequestsConfig;

use super::ImportError;

/// The EPUB and PDF files of the download as canonical paths on this server; other files are
/// left unmapped. The two download folders map the client's view onto ours: both set, or
/// neither, in which case the download's own save folder is the same place to both. A listed
/// file that was never written (the client lists files it was told to skip) is left out; one
/// that leads outside the download folder fails the import. Does blocking filesystem calls.
pub fn resolve(
    status: &TorrentStatus,
    files: &[ClientFile],
    config: &RequestsConfig,
) -> Result<Vec<PathBuf>, ImportError> {
    let save = Path::new(&status.save_path);
    let (client_prefix, local_prefix) = match (
        config.download_client_path_prefix.as_deref(),
        config.download_path_prefix.as_deref(),
    ) {
        (Some(client), Some(local)) => (Path::new(client), Path::new(local)),
        (None, None) => (save, save),
        _ => {
            return Err(ImportError::Cannot(
                "set both download folders or neither".into(),
            ))
        }
    };
    // A missing download folder is not a missing file.
    local_prefix.canonicalize().map_err(PathMapError::from)?;
    let mut found = Vec::new();
    for file in files
        .iter()
        .filter(|f| ebook_extension(Path::new(&f.name)).is_some())
    {
        match map_client_path(&save.join(&file.name), client_prefix, local_prefix) {
            Ok(path) => found.push(path),
            Err(PathMapError::Io(e)) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(found)
}

/// The file to add and its format: an EPUB over a PDF, then the largest. Only a file whose
/// extension and opening bytes agree on `epub` or `pdf` counts. Reads each candidate's first
/// bytes, so it is blocking.
pub fn pick(paths: &[PathBuf]) -> Result<(PathBuf, &'static str), ImportError> {
    let mut best: Option<((bool, u64), PathBuf, &'static str)> = None;
    for path in paths {
        let Some(format) = confirmed_format(path)? else {
            continue;
        };
        let rank = (format == "epub", path.metadata()?.len());
        if best.as_ref().is_none_or(|(top, ..)| rank > *top) {
            best = Some((rank, path.clone(), format));
        }
    }
    best.map(|(_, path, format)| (path, format))
        .ok_or(ImportError::NothingImportable)
}

/// `epub` or `pdf` when `path`'s extension names it, in any case.
fn ebook_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    matches!(extension.as_str(), "epub" | "pdf").then_some(extension)
}

/// `epub` or `pdf` when `path`'s extension names it and its opening bytes agree.
fn confirmed_format(path: &Path) -> Result<Option<&'static str>, ImportError> {
    let Some(extension) = ebook_extension(path) else {
        return Ok(None);
    };
    let mut head = Vec::with_capacity(EBOOK_MAGIC_LEN);
    File::open(path)?
        .take(EBOOK_MAGIC_LEN as u64)
        .read_to_end(&mut head)?;
    Ok(detect_ebook_format(&head).filter(|sniffed| *sniffed == extension))
}
