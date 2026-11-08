//! Puts a downloaded file, or a folder of audiobook parts, into the library in one step the
//! scanner can never see half of. The files are linked (or copied) into a staging folder
//! inside the library root, so they are on the same filesystem, then renamed to their
//! canonical place. Staging is a dot folder,
//! which every library walk skips, and it is cleared on every exit, so nothing
//! half-copied is ever left to be indexed. The download itself is only read.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::library_layout::{
    allocate_canonical_dir, allocate_canonical_path, sanitize_part_filename,
};

/// The folder under the library root that holds an import in progress.
const STAGING_DIR: &str = ".omnibus-staging";

fn staging_dir(root: &Path, request_id: i64) -> PathBuf {
    root.join(STAGING_DIR).join(request_id.to_string())
}

/// Put `src` into the library under `root` as `ext`, named from the book's `author` and
/// `title`, and return where it landed. A fresh staging folder is made for `request_id`
/// first, and removed whatever happens. `src` is never changed or moved. Blocking.
pub fn place_blocking(
    root: &Path,
    request_id: i64,
    src: &Path,
    author: &str,
    title: &str,
    ext: &str,
) -> io::Result<PathBuf> {
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
    // A link costs no space; a different filesystem or one without links gets a copy.
    link_or_copy(src, &staged)?;
    let dest = allocate_canonical_path(root, author, title, ext)?;
    if let Some(folder) = dest.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::rename(&staged, &dest)?;
    Ok(dest)
}

/// Put `parts` into one new canonical folder under `root`, named from the book's `author`
/// and `title`, and return the folder. Each part is named for its path below the parts'
/// common parent (`CD1/01.mp3` becomes `cd1-01.mp3`); two parts that come to one name fail.
/// Staged and cleaned up as [`place_blocking`] does. Blocking.
pub fn place_folder_blocking(
    root: &Path,
    request_id: i64,
    parts: &[PathBuf],
    author: &str,
    title: &str,
) -> io::Result<PathBuf> {
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
    for part in parts {
        let name = part_name(part.strip_prefix(&below).unwrap_or(part));
        let staged = staging.join(name);
        if staged.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("two parts would both be filed as {}", staged.display()),
            ));
        }
        link_or_copy(part, &staged)?;
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
