//! Tests for the import: picking the file out of a download, placing it, and the whole run.

use std::fs;
use std::path::{Path, PathBuf};

mod files;
mod place;
mod run;

const EPUB_BYTES: &[u8] = b"PK\x03\x04 an epub";

/// Write `bytes` to `root/name`, making the folders it sits in.
fn write(root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}
