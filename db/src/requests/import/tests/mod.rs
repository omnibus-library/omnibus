//! Tests for the import: picking the file out of a download, placing it, and the whole run.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

mod audio;
mod convert;
mod files;
mod place;
mod run;

const EPUB_BYTES: &[u8] = b"PK\x03\x04 an epub";
/// An MP4 `ftyp` box, enough for the magic check.
const M4B_BYTES: &[u8] = b"\x00\x00\x00\x18ftypM4B  an audiobook";
const MP3_BYTES: &[u8] = b"ID3\x04\x00\x00\x00\x00\x00\x00 an mp3";

/// A MOBI or AZW3 file's head: the PalmDB type and creator, `BOOKMOBI`, sit at byte 60.
fn mobi_bytes() -> Vec<u8> {
    [&[0u8; 60][..], b"BOOKMOBI", b" a mobi"].concat()
}

/// Write `bytes` to `root/name`, making the folders it sits in.
fn write(root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}

/// Write an executable `ebook-convert` stand-in at `dir/ebook-convert`, and return its path.
fn write_script(dir: &Path, body: &str) -> PathBuf {
    let path = dir.join("ebook-convert");
    let version = "if [ \"$1\" = \"--version\" ]; then echo 'ebook-convert 0-fake'; exit 0; fi";
    fs::write(&path, format!("#!/bin/sh\n{version}\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// A fake `ebook-convert` that records the file it was asked to convert in `dir/src-arg`,
/// then copies `output` over the file it was asked to write.
fn working_converter(dir: &Path, output: &Path) -> PathBuf {
    let body = format!(
        "echo \"$1\" > '{dir}/src-arg'\ncp '{output}' \"$2\"",
        dir = dir.display(),
        output = output.display(),
    );
    write_script(dir, &body)
}

/// A fake `ebook-convert` that fails with `boom: conversion failed` on stderr.
fn failing_converter(dir: &Path) -> PathBuf {
    write_script(dir, "echo 'boom: conversion failed' 1>&2\nexit 3")
}
