//! Tests for the track census on synthetic box trees: one handler kind at a
//! time, both together, `moov` placed after a 32-bit and a 64-bit `mdat`,
//! and the unreadable cases.

use super::*;
use crate::audiobook::chapters::tests::{box_with, full_box, hdlr_box, temp_with_bytes};

/// A `trak` whose media declares `handler`, and nothing else.
fn trak_with_handler(handler: &[u8; 4]) -> Vec<u8> {
    let mdia = box_with(b"mdia", &hdlr_box(handler));
    box_with(b"trak", &mdia)
}

/// `ftyp` + `moov` holding the given tracks, `moov` first.
fn container(traks: &[Vec<u8>]) -> Vec<u8> {
    let mut out = ftyp();
    out.extend_from_slice(&box_with(b"moov", &traks.concat()));
    out
}

fn ftyp() -> Vec<u8> {
    let mut body = b"M4B ".to_vec();
    body.extend_from_slice(&0u32.to_be_bytes());
    box_with(b"ftyp", &body)
}

#[test]
fn inspect_mp4_tracks_counts_a_video_only_container() {
    let file = temp_with_bytes(&container(&[trak_with_handler(b"vide")]));
    let tracks = inspect_mp4_tracks(file.path()).unwrap();
    assert_eq!(tracks, Mp4Tracks { audio: 0, video: 1 });
}

#[test]
fn inspect_mp4_tracks_counts_an_audio_only_container() {
    let file = temp_with_bytes(&container(&[trak_with_handler(b"soun")]));
    let tracks = inspect_mp4_tracks(file.path()).unwrap();
    assert_eq!(tracks, Mp4Tracks { audio: 1, video: 0 });
}

#[test]
fn inspect_mp4_tracks_counts_both_kinds_and_ignores_other_handlers() {
    // A chapter text track and a `trak` with no `mdia` are neither kind.
    let bare_trak = box_with(b"trak", &[]);
    let file = temp_with_bytes(&container(&[
        trak_with_handler(b"soun"),
        trak_with_handler(b"text"),
        trak_with_handler(b"vide"),
        bare_trak,
    ]));
    let tracks = inspect_mp4_tracks(file.path()).unwrap();
    assert_eq!(tracks, Mp4Tracks { audio: 1, video: 1 });
}

#[test]
fn inspect_mp4_tracks_finds_moov_after_mdat() {
    // Real muxers write the media payload first; the walker must step over
    // it by its declared size rather than scanning it.
    let mut bytes = ftyp();
    bytes.extend_from_slice(&box_with(b"mdat", &vec![0xAAu8; 64 * 1024]));
    bytes.extend_from_slice(&box_with(b"moov", &trak_with_handler(b"soun")));
    let file = temp_with_bytes(&bytes);
    let tracks = inspect_mp4_tracks(file.path()).unwrap();
    assert_eq!(tracks, Mp4Tracks { audio: 1, video: 0 });
}

#[test]
fn inspect_mp4_tracks_seeks_past_a_largesize_mdat() {
    // size == 1 selects the 64-bit `largesize` header; the payload length is
    // carried there, not in the 32-bit field.
    let payload = vec![0xAAu8; 4096];
    let mut mdat = 1u32.to_be_bytes().to_vec();
    mdat.extend_from_slice(b"mdat");
    mdat.extend_from_slice(&(16 + payload.len() as u64).to_be_bytes());
    mdat.extend_from_slice(&payload);

    let mut bytes = ftyp();
    bytes.extend_from_slice(&mdat);
    bytes.extend_from_slice(&box_with(b"moov", &trak_with_handler(b"vide")));
    let file = temp_with_bytes(&bytes);
    let tracks = inspect_mp4_tracks(file.path()).unwrap();
    assert_eq!(tracks, Mp4Tracks { audio: 0, video: 1 });
}

#[test]
fn inspect_mp4_tracks_errors_when_no_moov_box_exists() {
    // An `ftyp` alone passes the magic-byte sniff but describes no tracks.
    let file = temp_with_bytes(&ftyp());
    let err = inspect_mp4_tracks(file.path()).unwrap_err();
    assert!(err.to_string().contains("no moov box"), "got: {err}");
}

#[test]
fn inspect_mp4_tracks_errors_for_a_missing_file() {
    assert!(inspect_mp4_tracks(Path::new("/definitely/not/here.m4b")).is_err());
}

#[test]
fn inspect_mp4_tracks_survives_truncation_at_every_offset() {
    let full = container(&[trak_with_handler(b"soun"), trak_with_handler(b"vide")]);
    for cut in 0..=full.len() {
        let file = temp_with_bytes(&full[..cut]);
        // Must not panic; the result is whatever the walker salvages.
        let _ = inspect_mp4_tracks(file.path());
    }
}

#[test]
fn inspect_mp4_tracks_ignores_a_full_box_where_a_trak_was_expected() {
    // A stray full-box sibling under `moov` (an `mvhd`) is skipped, not
    // mistaken for a track.
    let mvhd = full_box(b"mvhd", 0, &[0u8; 96]);
    let file = temp_with_bytes(&container(&[mvhd, trak_with_handler(b"soun")]));
    let tracks = inspect_mp4_tracks(file.path()).unwrap();
    assert_eq!(tracks, Mp4Tracks { audio: 1, video: 0 });
}
