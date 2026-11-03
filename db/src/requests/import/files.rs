//! Which of a finished download's files is the book. [`resolve`] maps the client's list of
//! files onto this server's disk, refusing any that lead outside the download folder, and
//! [`pick`] keeps the ones whose bytes really are an EPUB or PDF.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use omnibus_shared::{detect_ebook_format, EBOOK_MAGIC_LEN};

use crate::requests::clients::{ClientFile, TorrentStatus};
use crate::requests::paths::map_client_path;
use crate::settings::RequestsConfig;

use super::ImportError;

/// Every file of the download as a canonical path on this server. The two download folders
/// map the client's view onto ours; with either unset, the download's own save folder is
/// the same place to both. Does blocking filesystem calls.
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
        _ => (save, save),
    };
    files
        .iter()
        .map(|file| {
            Ok(map_client_path(
                &save.join(&file.name),
                client_prefix,
                local_prefix,
            )?)
        })
        .collect()
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

/// `epub` or `pdf` when `path`'s extension names it and its opening bytes agree.
fn confirmed_format(path: &Path) -> Result<Option<&'static str>, ImportError> {
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase());
    if !matches!(extension.as_deref(), Some("epub" | "pdf")) {
        return Ok(None);
    }
    let mut head = Vec::with_capacity(EBOOK_MAGIC_LEN);
    File::open(path)?
        .take(EBOOK_MAGIC_LEN as u64)
        .read_to_end(&mut head)?;
    Ok(detect_ebook_format(&head).filter(|sniffed| Some(*sniffed) == extension.as_deref()))
}
