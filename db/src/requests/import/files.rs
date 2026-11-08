//! Which of a finished download's files is the book. [`resolve`] maps the client's list of
//! files onto this server's disk, refusing any that lead outside the download folder, and
//! [`pick`] keeps the one ebook whose bytes really are an EPUB or PDF, where [`pick_audio`]
//! keeps the one M4B or the MP3s whose bytes really are audio.

use std::collections::HashSet;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use omnibus_shared::{
    detect_audiobook_format, detect_ebook_format, RequestKind, AUDIOBOOK_MAGIC_LEN, EBOOK_MAGIC_LEN,
};

use crate::audiobook::AUDIOBOOK_EXTENSIONS;
use crate::requests::clients::{ClientFile, TorrentStatus};
use crate::requests::paths::{map_client_path, PathMapError};
use crate::settings::RequestsConfig;

use super::ImportError;

/// The files of the download that `kind` imports (EPUB and PDF, or M4B, M4A and MP3) as
/// canonical paths on this server; other files are left unmapped. The two download folders map the client's view onto ours: both set, or
/// neither, in which case the download's own save folder is the same place to both. A listed
/// file that was never written (the client lists files it was told to skip) is left out; one
/// that leads outside the download folder fails the import. Does blocking filesystem calls.
pub fn resolve(
    status: &TorrentStatus,
    files: &[ClientFile],
    config: &RequestsConfig,
    kind: RequestKind,
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
    for file in files.iter().filter(|f| imports(kind, Path::new(&f.name))) {
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

fn imports(kind: RequestKind, path: &Path) -> bool {
    match kind {
        RequestKind::Ebook => ebook_extension(path).is_some(),
        RequestKind::Audiobook => audio_extension(path).is_some(),
    }
}

/// What [`pick_audio`] chose to file.
#[derive(Debug)]
pub enum AudioPick {
    /// One M4B or M4A, filed alone; its lowercase extension.
    Single(PathBuf, &'static str),
    /// Every MP3, filed together in one folder.
    Parts(Vec<PathBuf>),
}

/// The audiobook to add: a lone M4B (else M4A) at least as large as the release's MP3s, else
/// the MP3s of one folder. Several containers of the best format, or MP3s in several folders,
/// are refused, because each would be a book of its own or play interleaved. Only a file whose
/// extension and opening bytes agree counts. Reads each candidate's first bytes, so it is blocking.
pub fn pick_audio(paths: &[PathBuf]) -> Result<AudioPick, ImportError> {
    let mut confirmed: Vec<(PathBuf, &'static str)> = Vec::new();
    for path in paths {
        if let Some(extension) = confirmed_audio_format(path)? {
            confirmed.push((path.clone(), extension));
        }
    }
    let mp3s: Vec<PathBuf> = confirmed
        .iter()
        .filter(|(_, ext)| *ext == "mp3")
        .map(|(path, _)| path.clone())
        .collect();
    if let Some((path, ext)) = lone_container(&confirmed)? {
        if mp3s.is_empty() || path.metadata()?.len() >= total_size(&mp3s)? {
            return Ok(AudioPick::Single(path, ext));
        }
    }
    if mp3s.is_empty() {
        return Err(ImportError::Cannot(
            "the download has no audiobook file to add".into(),
        ));
    }
    let folders: HashSet<_> = mp3s.iter().map(|path| path.parent()).collect();
    if folders.len() > 1 {
        return Err(ImportError::Cannot(
            "this version is split across several folders".into(),
        ));
    }
    Ok(AudioPick::Parts(mp3s))
}

/// The one M4B, else the one M4A, of the confirmed files; several of the first format that
/// has any are refused.
fn lone_container(
    confirmed: &[(PathBuf, &'static str)],
) -> Result<Option<(PathBuf, &'static str)>, ImportError> {
    for container in ["m4b", "m4a"] {
        let mut of_format = confirmed.iter().filter(|(_, ext)| *ext == container);
        match (of_format.next(), of_format.next()) {
            (Some((path, ext)), None) => return Ok(Some((path.clone(), ext))),
            (Some(_), Some(_)) => {
                return Err(ImportError::Cannot(format!(
                    "this version is split into several {} files",
                    container.to_uppercase()
                )))
            }
            _ => {}
        }
    }
    Ok(None)
}

fn total_size(paths: &[PathBuf]) -> io::Result<u64> {
    paths.iter().map(|p| Ok(p.metadata()?.len())).sum()
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

/// An [`AUDIOBOOK_EXTENSIONS`] entry when `path`'s extension names it, in any case.
fn audio_extension(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    AUDIOBOOK_EXTENSIONS
        .iter()
        .copied()
        .find(|known| *known == extension)
}

/// The extension when it names audio and the opening bytes agree: an MP4 box for `m4b` and
/// `m4a`, MP3 framing for `mp3`.
fn confirmed_audio_format(path: &Path) -> Result<Option<&'static str>, ImportError> {
    let Some(extension) = audio_extension(path) else {
        return Ok(None);
    };
    let mut head = Vec::with_capacity(AUDIOBOOK_MAGIC_LEN);
    File::open(path)?
        .take(AUDIOBOOK_MAGIC_LEN as u64)
        .read_to_end(&mut head)?;
    let family = if extension == "mp3" { "mp3" } else { "mp4" };
    Ok((detect_audiobook_format(&head) == Some(family)).then_some(extension))
}
