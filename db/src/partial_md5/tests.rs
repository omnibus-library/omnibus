//! `partial_md5` against digests computed outside it: the sample offsets, the end-of-file stops
//! and a fixture EPUB.

use super::*;

/// `len` bytes of a repeating 0..251 ramp, so every KiB sample differs.
fn ramp_file(dir: &tempfile::TempDir, len: usize) -> std::path::PathBuf {
    let path = dir.path().join("book.bin");
    std::fs::write(&path, (0..len).map(|i| (i % 251) as u8).collect::<Vec<_>>()).unwrap();
    path
}

// Expected digests below come from `dd` + `md5sum` over the same samples, not from this module.
#[test]
fn partial_md5_of_an_empty_file_is_the_empty_digest() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        partial_md5(&ramp_file(&dir, 0)).unwrap(),
        "d41d8cd98f00b204e9800998ecf8427e"
    );
}

#[test]
fn partial_md5_hashes_a_short_file_whole() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        partial_md5(&ramp_file(&dir, 600)).unwrap(),
        "29fa7415033b32afb103bcad1d4cf3ad"
    );
}

#[test]
fn partial_md5_stops_when_the_second_sample_starts_at_end_of_file() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        partial_md5(&ramp_file(&dir, 1024)).unwrap(),
        "9ee0a0e0c0bc0f1ff29d663d1fdf0743"
    );
}

#[test]
fn partial_md5_skips_the_gap_between_samples() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        partial_md5(&ramp_file(&dir, 5000)).unwrap(),
        "e77dcca7f22a949ae8492c260ca19f32"
    );
}

#[test]
fn partial_md5_reads_the_sixteen_kib_sample_short() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        partial_md5(&ramp_file(&dir, 20000)).unwrap(),
        "04a4d10f5e5583d7173cce0782769cb1"
    );
}

#[test]
fn partial_md5_matches_what_koreader_records_for_a_fixture_epub() {
    let epub = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test_data/epubs/generated/alpha.epub");
    assert_eq!(
        partial_md5(&epub).unwrap(),
        "279e27fb695d12d161736300a93e255d"
    );
}

#[test]
fn partial_md5_errors_for_a_missing_file() {
    let dir = tempfile::tempdir().unwrap();
    assert!(partial_md5(&dir.path().join("nope.epub")).is_err());
}
