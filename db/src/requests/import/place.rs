//! Puts a downloaded file, or a folder of audiobook parts, into the library in one step the
//! scanner can never see half of. The files are linked (or copied) into a staging folder
//! inside the library root, so they are on the same filesystem, then renamed to their
//! canonical place; an AZW3 or MOBI is instead converted into the staging folder, from the
//! download. Staging is a dot folder, which every library walk skips, and it is cleared on
//! every exit, so nothing half-written is ever left to be indexed. The download itself is
//! only read.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use crate::library_layout::{
    allocate_canonical_dir, allocate_canonical_path, dedupe_part_name, sanitize_part_filename,
};

use super::{blocking, ImportError};

/// The folder under the library root that holds an import in progress.
const STAGING_DIR: &str = ".omnibus-staging";

fn staging_dir(root: &Path, request_id: i64) -> PathBuf {
    root.join(STAGING_DIR).join(request_id.to_string())
}

/// Fail unless `root` is a folder that exists, so an unmounted library is never filled on the
/// disk beneath its mount point.
fn require_root(root: &Path) -> io::Result<()> {
    if root.is_dir() {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "the library folder is missing",
    ))
}

/// Put `src` into the library under `root` as `ext`, named from the book's `author` and
/// `title`, and return where it landed. A fresh staging folder is made for `request_id`
/// first, and removed whatever happens. `src` is never changed or moved. Fails when `root` is
/// not an existing folder. Blocking.
pub fn place_blocking(
    root: &Path,
    request_id: i64,
    src: &Path,
    author: &str,
    title: &str,
    ext: &str,
) -> io::Result<PathBuf> {
    require_root(root)?;
    discard_staging(root, request_id)?;
    let placed = stage_and_rename(root, request_id, src, author, title, ext);
    if let Err(e) = discard_staging(root, request_id) {
        tracing::warn!(error = %e, request = request_id, "could not clear the import staging folder");
    }
    placed
}

fn stage_and_rename(
    root: &Path,
    request_id: i64,
    src: &Path,
    author: &str,
    title: &str,
    ext: &str,
) -> io::Result<PathBuf> {
    let staging = staging_dir(root, request_id);
    fs::create_dir_all(&staging)?;
    let staged = staging.join(format!("book.{ext}"));
    link_or_copy(src, &staged)?;
    rename_into_library(root, &staged, author, title, ext)
}

/// Rename the staged file to a canonical path that is free, and return it.
fn rename_into_library(
    root: &Path,
    staged: &Path,
    author: &str,
    title: &str,
    ext: &str,
) -> io::Result<PathBuf> {
    let dest = allocate_canonical_path(root, author, title, ext)?;
    if let Some(folder) = dest.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::rename(staged, &dest)?;
    Ok(dest)
}

/// [`place_blocking`]'s twin for an AZW3 or MOBI: convert `src`, straight from the download,
/// into a fresh staging folder for `request_id` as an EPUB, then rename it into the library.
/// Staging is removed whatever happens, and `src` is never changed.
pub async fn place_converted(
    pool: &SqlitePool,
    root: &Path,
    request_id: i64,
    src: &Path,
    author: &str,
    title: &str,
) -> Result<PathBuf, ImportError> {
    let staging = blocking({
        let root = root.to_path_buf();
        move || {
            require_root(&root)?;
            discard_staging(&root, request_id)?;
            let staging = staging_dir(&root, request_id);
            fs::create_dir_all(&staging)?;
            Ok::<PathBuf, io::Error>(staging)
        }
    })
    .await?;
    let staged = staging.join("book.epub");
    let placed = match crate::convert::convert_file(pool, src, &staged).await {
        Ok(()) => {
            let (root, author, title) = (root.to_path_buf(), author.to_string(), title.to_string());
            blocking(move || rename_into_library(&root, &staged, &author, &title, "epub"))
                .await
                .map_err(ImportError::from)
        }
        Err(e) => Err(e.into()),
    };
    let root = root.to_path_buf();
    let cleared = blocking(move || discard_staging(&root, request_id)).await;
    if let Err(e) = cleared {
        tracing::warn!(error = %e, request = request_id, "could not clear the import staging folder");
    }
    placed
}

/// Put `parts` into one new canonical folder under `root`, named from the book's `author`
/// and `title`, and return the folder. Each part is named for its path below the parts'
/// common parent (`CD1/01.mp3` becomes `cd1-01.mp3`); two that come to one name are numbered.
/// Staged and cleaned up as [`place_blocking`] does. Blocking.
pub fn place_folder_blocking(
    root: &Path,
    request_id: i64,
    parts: &[PathBuf],
    author: &str,
    title: &str,
) -> io::Result<PathBuf> {
    require_root(root)?;
    discard_staging(root, request_id)?;
    let placed = stage_folder_and_rename(root, request_id, parts, author, title);
    if let Err(e) = discard_staging(root, request_id) {
        tracing::warn!(error = %e, request = request_id, "could not clear the import staging folder");
    }
    placed
}

fn stage_folder_and_rename(
    root: &Path,
    request_id: i64,
    parts: &[PathBuf],
    author: &str,
    title: &str,
) -> io::Result<PathBuf> {
    let staging = staging_dir(root, request_id).join("book");
    fs::create_dir_all(&staging)?;
    let below = common_parent(parts);
    let mut used = HashSet::new();
    for part in parts {
        let name = dedupe_part_name(
            part_name(part.strip_prefix(&below).unwrap_or(part)),
            &mut used,
        );
        link_or_copy(part, &staging.join(name))?;
    }
    let dest = allocate_canonical_dir(root, author, title)?;
    if let Some(author_dir) = dest.parent() {
        fs::create_dir_all(author_dir)?;
    }
    fs::rename(&staging, &dest)?;
    Ok(dest)
}

/// A link costs no space; a different filesystem or one without links gets a copy.
fn link_or_copy(src: &Path, dest: &Path) -> io::Result<()> {
    fs::hard_link(src, dest).or_else(|_| fs::copy(src, dest).map(|_| ()))
}

/// The deepest folder every part sits under.
fn common_parent(parts: &[PathBuf]) -> PathBuf {
    let mut dirs = parts.iter().filter_map(|p| p.parent());
    let Some(first) = dirs.next() else {
        return PathBuf::new();
    };
    let mut common: Vec<_> = first.components().collect();
    for dir in dirs {
        let shared = common
            .iter()
            .zip(dir.components())
            .take_while(|(a, b)| *a == b)
            .count();
        common.truncate(shared);
    }
    common.into_iter().collect()
}

/// The filename a part is filed under: its folders and name joined with `-`.
fn part_name(relative: &Path) -> String {
    let joined: Vec<_> = relative.iter().map(|c| c.to_string_lossy()).collect();
    sanitize_part_filename(&joined.join("-"))
}

/// Remove request `request_id`'s staging folder, and the shared one when it is left empty.
/// Nothing there is not an error. Blocking.
pub fn discard_staging(root: &Path, request_id: i64) -> io::Result<()> {
    match fs::remove_dir_all(staging_dir(root, request_id)) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    }
    // Fails while another import is staged, which is what keeps that one safe.
    let _ = fs::remove_dir(root.join(STAGING_DIR));
    Ok(())
}
