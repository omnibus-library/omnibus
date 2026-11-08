//! Tests for the import: picking the file out of a download, placing it, and the whole run.

use std::fs;
use std::path::{Path, PathBuf};

mod audio;
mod files;
mod place;
mod run;

const EPUB_BYTES: &[u8] = b"PK\x03\x04 an epub";
/// An MP4 `ftyp` box, enough for the magic check.
const M4B_BYTES: &[u8] = b"\x00\x00\x00\x18ftypM4B  an audiobook";
const MP3_BYTES: &[u8] = b"ID3\x04\x00\x00\x00\x00\x00\x00 an mp3";

/// Write `bytes` to `root/name`, making the folders it sits in.
fn write(root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}
