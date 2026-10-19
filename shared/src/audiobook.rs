//! Audiobook manifest wire types for `GET /api/audiobooks/{uuid}/manifest`.
//!
//! `Direct` is the natively-playable path (m4b/m4a/mp3/aac — Range-served per
//! part); `Hls` is the segmented-transcode fallback for codecs the browser
//! cannot decode directly (flac, ac3, eac3, …).

use serde::{Deserialize, Serialize};

/// Slowest playback rate accepted by every audiobook client and transport.
pub const MIN_AUDIOBOOK_PLAYBACK_RATE: f64 = 0.5;
/// Fastest playback rate accepted by every audiobook client and transport.
pub const MAX_AUDIOBOOK_PLAYBACK_RATE: f64 = 3.0;

/// A new playback speed for one audiobook. `playback_rate` runs from 0.5 to 3.0.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AudiobookPlaybackRateUpdate {
    pub playback_rate: f64,
}

impl AudiobookPlaybackRateUpdate {
    /// Reject non-finite rates and values outside the player-supported range.
    pub fn validate(&self) -> Result<(), String> {
        if !self.playback_rate.is_finite()
            || !(MIN_AUDIOBOOK_PLAYBACK_RATE..=MAX_AUDIOBOOK_PLAYBACK_RATE)
                .contains(&self.playback_rate)
        {
            return Err(format!(
                "playback_rate must be between {MIN_AUDIOBOOK_PLAYBACK_RATE} and {MAX_AUDIOBOOK_PLAYBACK_RATE}"
            ));
        }
        Ok(())
    }
}

/// The playback speed you saved for one audiobook.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AudiobookPlaybackRateRecord {
    pub book_uuid: String,
    pub playback_rate: f64,
    /// When the speed was saved, in Unix seconds.
    pub updated_at: i64,
}

/// One part of an audiobook file in a `direct` manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ManifestPart {
    pub ordinal: i64,
    pub url: String,
    pub duration_seconds: f64,
    pub mime: String,
}

/// A chapter on an audiobook file's timeline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ChapterInfo {
    pub ordinal: i64,
    pub title: String,
    pub start_seconds: f64,
    pub duration_seconds: f64,
}

/// How to play one audiobook file, from `GET /api/audiobooks/{uuid}/manifest`. In
/// `direct` mode each part has a URL to stream with `Range` requests. In `hls` mode one
/// playlist plays a server-side transcode, for formats a player can't decode. Both modes
/// carry `book_file_id`, the file a progress write must name, and `audio_file_count`.
/// When the count is above 1, a position means something only with its file id. A 0 in
/// either field means the server didn't say.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum AudiobookManifest {
    Direct {
        #[serde(default)]
        book_file_id: i64,
        #[serde(default)]
        audio_file_count: i64,
        /// The book's next audio file, by `id`. A player moves on to it when this file
        /// ends, rather than marking the book finished. Null on the last file, and when
        /// the book's files are separate narrations of the whole book.
        #[serde(default)]
        next_file_id: Option<i64>,
        parts: Vec<ManifestPart>,
        total_duration_seconds: f64,
        #[serde(default)]
        chapters: Vec<ChapterInfo>,
    },
    Hls {
        #[serde(default)]
        book_file_id: i64,
        #[serde(default)]
        audio_file_count: i64,
        /// The book's next audio file, by `id`. A player moves on to it when this file
        /// ends, rather than marking the book finished. Null on the last file, and when
        /// the book's files are separate narrations of the whole book.
        #[serde(default)]
        next_file_id: Option<i64>,
        playlist_url: String,
    },
}

impl AudiobookManifest {
    /// The `(book_file_id, audio_file_count)` identity pair, zero-valued
    /// when the serving server predates those fields.
    pub fn file_identity(&self) -> (i64, i64) {
        match self {
            AudiobookManifest::Direct {
                book_file_id,
                audio_file_count,
                ..
            }
            | AudiobookManifest::Hls {
                book_file_id,
                audio_file_count,
                ..
            } => (*book_file_id, *audio_file_count),
        }
    }

    /// The next file in ordinal order, when one exists (see the field doc).
    pub fn next_file_id(&self) -> Option<i64> {
        match self {
            AudiobookManifest::Direct { next_file_id, .. }
            | AudiobookManifest::Hls { next_file_id, .. } => *next_file_id,
        }
    }
}

/// Query parameters of `GET /api/audiobooks/{uuid}/manifest`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct ManifestQuery {
    /// One of the book's audio files, by its `id` in the book's `book_files`. Defaults to
    /// the first.
    pub file_id: Option<i64>,
}

/// Query parameters of `GET /api/audiobooks/{uuid}/parts/{ordinal}`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct PartsQuery {
    /// The audio file the part belongs to, by its `id` in the book's `book_files`. Defaults
    /// to the first. The manifest's part URLs already carry it.
    pub file_id: Option<i64>,
}

/// Query parameters of `GET /api/audiobooks/{uuid}/download`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct AudiobookDownloadQuery {
    /// One of the book's audio files, by its `id` in the book's `book_files`. Defaults to
    /// the first.
    pub file_id: Option<i64>,
    /// The part of that file to download, by its `ordinal`. Defaults to the first part.
    pub part: Option<i64>,
}

/// Where an audiobook's HLS transcode stands: `preparing` while it is queued or running,
/// `ready` once every segment is made, and `failed` when it failed, which isn't retried on
/// its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum AudiobookStatusState {
    Preparing,
    Ready,
    Failed,
}

/// How far an audiobook's HLS transcode has got, from `GET /api/audiobooks/{uuid}/status`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AudiobookStatus {
    /// Whether the transcode has finished. It is an older field, so read `state` instead.
    pub ready: bool,
    /// How far the transcode has got, from 0.0 to 1.0.
    pub progress: f32,
    pub state: AudiobookStatusState,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_rate_update_accepts_supported_bounds() {
        for playback_rate in [0.5, 3.0] {
            let update = AudiobookPlaybackRateUpdate { playback_rate };
            assert!(update.validate().is_ok());
        }
    }

    #[test]
    fn playback_rate_update_rejects_rates_outside_supported_bounds() {
        for playback_rate in [0.49, 3.01] {
            let update = AudiobookPlaybackRateUpdate { playback_rate };
            assert!(update.validate().is_err());
        }
    }

    #[test]
    fn playback_rate_update_rejects_non_finite_rates() {
        for playback_rate in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let update = AudiobookPlaybackRateUpdate { playback_rate };
            assert!(update.validate().is_err());
        }
    }

    #[test]
    fn manifest_decodes_legacy_payload_without_file_identity_as_zeros() {
        let legacy = r#"{"mode":"direct","parts":[],"total_duration_seconds":1.5}"#;
        let manifest: AudiobookManifest = serde_json::from_str(legacy).unwrap();
        assert_eq!(manifest.file_identity(), (0, 0));
    }

    #[test]
    fn manifest_file_identity_reads_both_variants() {
        let direct = AudiobookManifest::Direct {
            book_file_id: 919,
            audio_file_count: 5,
            next_file_id: Some(922),
            parts: vec![],
            total_duration_seconds: 1.0,
            chapters: vec![],
        };
        let hls = AudiobookManifest::Hls {
            book_file_id: 7,
            audio_file_count: 2,
            next_file_id: None,
            playlist_url: "/x.m3u8".into(),
        };
        assert_eq!(direct.file_identity(), (919, 5));
        assert_eq!(hls.file_identity(), (7, 2));
        assert_eq!(direct.next_file_id(), Some(922));
        assert_eq!(hls.next_file_id(), None);
    }

    #[test]
    fn playback_rate_record_round_trips_over_json() {
        let record = AudiobookPlaybackRateRecord {
            book_uuid: "book-a".into(),
            playback_rate: 1.5,
            updated_at: 123,
        };
        let json = serde_json::to_string(&record).unwrap();
        assert_eq!(
            serde_json::from_str::<AudiobookPlaybackRateRecord>(&json).unwrap(),
            record
        );
    }
}
