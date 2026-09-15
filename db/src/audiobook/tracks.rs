//! Track census of an ISO-BMFF (`.mp4`/`.m4a`/`.m4b`) container: how many
//! `soun` and `vide` handlers its `moov > trak > mdia > hdlr` chain declares.
//! The upload endpoint uses it to tell an audio-only container from a video
//! that was renamed, before filing the file as an audiobook.

use std::path::Path;

use super::chapters::{find_box, find_child_box, list_child_boxes, media_handler};

/// How many tracks of each kind a container declares.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Mp4Tracks {
    /// Tracks whose handler is `soun`.
    pub audio: usize,
    /// Tracks whose handler is `vide`.
    pub video: usize,
}

/// Count the audio and video tracks in the container at `path`.
///
/// Walks `moov > trak > mdia > hdlr` seeking by box size — including a 64-bit
/// `largesize` — so a multi-GB `mdat` ahead of `moov` (where real muxers put
/// it) costs one seek, not a read. A `trak` with no `mdia` or an unreadable
/// handler counts as neither kind. Errors when the file cannot be opened or
/// carries no `moov`: that is an unreadable container, not a verdict on its
/// tracks, and the caller reports it as such.
pub fn inspect_mp4_tracks(path: &Path) -> anyhow::Result<Mp4Tracks> {
    let mut file = std::fs::File::open(path)?;
    let file_len = file.metadata()?.len();
    let Some(moov) = find_box(&mut file, file_len, b"moov") else {
        anyhow::bail!("no moov box found");
    };

    let mut tracks = Mp4Tracks::default();
    for (box_type, trak) in list_child_boxes(&mut file, moov.data_offset, moov.data_size) {
        if &box_type != b"trak" {
            continue;
        }
        let Some(mdia) = find_child_box(&mut file, trak.data_offset, trak.data_size, b"mdia")
        else {
            continue;
        };
        match media_handler(&mut file, &mdia).as_ref() {
            Some(b"soun") => tracks.audio += 1,
            Some(b"vide") => tracks.video += 1,
            _ => {}
        }
    }
    Ok(tracks)
}

#[cfg(test)]
mod tests;
