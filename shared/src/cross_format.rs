//! Cross-format progress sync wire types: the resume candidate served by
//! `GET /api/books/{uuid}/cross-format-resume`. Every answer carries its
//! mapping confidence so clients can present it honestly (≈-labeled for
//! the linear tier), and the endpoint states *why* when there is no
//! candidate rather than answering with silence.

use serde::{Deserialize, Serialize};

use crate::progress::ProgressFormat;

#[cfg(test)]
mod tests;

/// A refusal a client can act on, carried as the RPC error's status code so
/// no client has to read the display text. Not in `details`: Dioxus decodes
/// that *as* the `CapturedError`, dropping the status and message with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrossFormatErrorCode {
    /// 428: the user must confirm an alignment before syncing these formats.
    LinkRequired,
    /// 412: the linked audio set changed and must be confirmed again.
    AudioSetMismatch,
    /// 409: the other format has no stored position to pair with.
    CounterpartMissing,
}

impl CrossFormatErrorCode {
    const ALL: [Self; 3] = [
        Self::LinkRequired,
        Self::AudioSetMismatch,
        Self::CounterpartMissing,
    ];

    /// The status code this refusal travels as.
    pub fn status(self) -> u16 {
        match self {
            Self::LinkRequired => 428,
            Self::AudioSetMismatch => 412,
            Self::CounterpartMissing => 409,
        }
    }

    /// The refusal a status code names, or `None` for any other failure.
    pub fn from_status(status: u16) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.status() == status)
    }
}

/// How a book's audio files relate to each other. The user says which when linking the
/// formats; the server never guesses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum CrossFormatLinkMode {
    /// The files play one after another as one audiobook, in their stored order.
    Sequence,
    /// Each file is a complete recording of the book. Only the primary one is aligned with
    /// the ebook.
    Narrations,
}

/// How a position was mapped from one format to the other, from least to most precise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum MappingConfidence {
    /// By proportion. A point some fraction of the way through one format maps to the same
    /// fraction of the other. Clients should present the result as approximate.
    Linear,
    /// Between chapters whose titles match in the ebook and the audio.
    ChapterAnchored,
    /// Between sync points the user declared. These outrank matched chapters.
    UserAnchored,
}

/// Whether there is a position to resume in the other format, and if not, why not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum CrossFormatResumeState {
    /// You have never linked this book's formats, so sync is off.
    NotLinked,
    /// The audio files changed after you linked the formats. Sync is paused until you link
    /// them again.
    LinkStale,
    /// The formats are linked, but the other format has no newer position, or it can't be
    /// mapped.
    NothingNewer,
    /// `candidate` holds the mapped position.
    Candidate,
    /// Both formats are already at the same place, within about half a percent of the
    /// book. `candidate` still holds the mapped position, but a client should not offer to
    /// jump there, since the jump would not move the reader.
    Aligned,
}

/// Where to resume a book in the other format, as
/// `GET /api/books/{uuid}/cross-format-resume` returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CrossFormatResume {
    pub state: CrossFormatResumeState,
    /// The mapped position. Present when `state` is `candidate` or `aligned`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate: Option<CrossFormatCandidate>,
    /// Whether follow mode is on. With it on, a client moves to a `candidate` position
    /// without asking.
    #[serde(default)]
    pub follow: bool,
}

impl CrossFormatResume {
    /// A candidate-less answer in the given state.
    pub fn empty(state: CrossFormatResumeState) -> Self {
        Self {
            state,
            candidate: None,
            follow: false,
        }
    }
}

/// Your position in one format, mapped onto the other. The audio fields are set when
/// `target` is `audio`, and `percent`, `fraction` and `epub_cfi` when it is `epub`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct CrossFormatCandidate {
    /// The format to resume in.
    pub target: ProgressFormat,
    /// The format the position was mapped from.
    pub source_format: ProgressFormat,
    /// The `client_updated_at` of the position it was mapped from, in Unix seconds. A
    /// client can compare it with positions it already knows to avoid offering the same
    /// one twice.
    pub source_client_updated_at: i64,
    pub confidence: MappingConfidence,
    /// The audio file to play.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_file_id: Option<i64>,
    /// Where to start, in seconds from the start of `book_file_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_position_seconds: Option<f64>,
    /// The length of the whole audiobook in seconds, across all its files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_duration_seconds: Option<f64>,
    /// How far through the book, from 0 to 100, rounded down from `fraction`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<i64>,
    /// How far through the book, from 0 to 1, at full precision. Jump to this, and show
    /// `percent`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fraction: Option<f64>,
    // The web reader shows this directly, so the fraction is never
    // reinterpreted on epub.js's different locations scale.
    /// The mapped place as a point EPUB CFI. Present only when the request asked for it
    /// with `derive=cfi` and the server could work it out. Otherwise use `fraction`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epub_cfi: Option<String>,
    /// The listening position it was mapped from, in seconds from the start of the whole
    /// audiobook. Set when `target` is `epub`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_position_seconds: Option<f64>,
    /// Whether the mapped position is ahead of your current position in `target`. False
    /// means the offer moves you back, so don't describe it as further on. Absent when
    /// there is no comparable position in `target`. Treat that as ahead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ahead: Option<bool>,
}

// Raw data rather than one precomputed map: the client re-runs the linear
// preview live as the user changes the declaration.
/// How a book's ebook and audiobook line up, as `GET /api/books/{uuid}/alignment` returns
/// it: the link and whether it is out of date, both formats' timelines, and your position
/// in each.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentView {
    /// The link you confirmed. Absent when the formats aren't linked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<AlignmentLink>,
    /// How well the ebook's chapters matched the audio's. For an unlinked book it shows what
    /// a `sequence` link would get. Absent when nothing anchors the mapping, which then
    /// works by proportion, and when `link.stale` is true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_match: Option<AlignmentMatch>,
    /// The ebook's timeline. Absent when the book has no EPUB, or the server hasn't measured
    /// it yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ebook: Option<AlignmentEbook>,
    /// The book's audio files, in their stored order.
    pub audio_files: Vec<AlignmentAudioFile>,
    /// Your reading position. Absent when you have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading: Option<AlignmentPosition>,
    /// Your listening position. Absent when you have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub listening: Option<AlignmentAudioPosition>,
    // Always serialized: the iOS `Codable` decode requires the key.
    /// The pairs of points the mapping runs through, in ebook order. Each pair is the
    /// fraction through the ebook, then the fraction through the audio, both from 0 to 1.
    /// Empty when nothing anchors the mapping.
    #[serde(default)]
    pub anchor_pairs: Vec<(f64, f64)>,
    /// How many usable chapter marks the audio has. Untitled marks don't count, and neither
    /// do the "Part 1", "Part 2" marks the server makes for files without chapters. When
    /// `anchor_match` is absent, zero means the audio has no chapter marks, and more than
    /// zero means its marks didn't match the ebook. Always zero when `link.stale` is true,
    /// so check that first.
    #[serde(default)]
    pub audio_chapter_marks: i64,
}

/// How well the ebook's chapters matched the audio's, such as 12 of 14 chapter titles.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentMatch {
    /// How many ebook chapters matched an audio chapter.
    pub matched: i64,
    /// How many chapters the ebook has.
    pub ebook_chapters: i64,
    pub confidence: MappingConfidence,
}

/// The link between a book's formats that you confirmed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentLink {
    pub mode: CrossFormatLinkMode,
    /// The narration aligned with the ebook, in `narrations` mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_book_file_id: Option<i64>,
    /// Whether the audio files changed since you confirmed the link. Sync is paused until
    /// you confirm it again.
    pub stale: bool,
    /// When you confirmed the link, in Unix seconds.
    pub confirmed_at: i64,
    /// Whether follow mode is on. With it on, a client moves to the newer position in the
    /// other format without asking.
    #[serde(default)]
    pub follow: bool,
    /// How many sync points you declared with `POST /api/books/{uuid}/sync-point`.
    #[serde(default)]
    pub user_anchors: i64,
}

/// The ebook's timeline: its length and where each chapter starts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentEbook {
    /// The ebook's length in visible characters.
    pub total_chars: i64,
    pub chapters: Vec<AlignmentEbookChapter>,
}

/// One chapter on the ebook's timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentEbookChapter {
    pub title: String,
    /// How far through the book the chapter starts, from 0 to 100.
    pub percent: f64,
    // `#[serde(default)]` so a payload from a server predating the field still decodes.
    /// The 0-based spine document the chapter starts in. Match a CFI's spine step against it
    /// to find a position's chapter. The rounded `percent` can land one chapter ahead when
    /// a chapter starts close to the position.
    #[serde(default)]
    pub spine_index: i64,
    /// The CFI step path of the chapter's start inside its spine document, such as
    /// `/4/2/6`, when the chapter shares that document with another chapter. It tells a
    /// client which of them a position is in. Absent when the chapter has its spine
    /// document to itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_path: Option<String>,
}

/// One of a book's audio files.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentAudioFile {
    pub book_file_id: i64,
    /// The file's path inside the library folder.
    pub label: String,
    pub duration_seconds: f64,
    /// Where each chapter in the file starts, in seconds from the start of the file.
    pub chapter_starts: Vec<f64>,
}

/// Your reading position, as the alignment shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentPosition {
    /// How far through the book, from 0 to 100. Absent for a moment after a position
    /// arrives with only a CFI, until the server works out the percent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<i64>,
    /// When the device recorded the position, in Unix seconds.
    pub client_updated_at: i64,
}

/// Your listening position, as the alignment shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AlignmentAudioPosition {
    /// The audio file the position is in. Absent when the position didn't name one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_file_id: Option<i64>,
    /// The position, in seconds from the start of the file.
    pub seconds: f64,
    /// When the device recorded the position, in Unix seconds.
    pub client_updated_at: i64,
}

/// How a book's ebook and audiobook line up, as `POST /api/books/{uuid}/cross-format-link`
/// takes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ConfirmCrossFormatLink {
    /// Required, but the server uses the uuid in the path instead.
    pub book_uuid: String,
    pub mode: CrossFormatLinkMode,
    /// The narration to align with the ebook. Required in `narrations` mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_book_file_id: Option<i64>,
    /// A new order for the book's audio files, as a list of every `book_file_id` once. It
    /// changes the order for every user, so it needs the edit permission. May be left out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_order: Option<Vec<i64>>,
}

/// A sync point, as `POST /api/books/{uuid}/sync-point` takes it: your position in the
/// format you're using, which the server pairs with your saved position in the other.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct DeclareSyncPoint {
    /// Required, but the server uses the uuid in the path instead.
    pub book_uuid: String,
    /// The format you're using.
    pub format: ProgressFormat,
    /// How far through the book you are, from 0 to 1. Required for `epub`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ebook_fraction: Option<f64>,
    // `ebook_fraction` from the web reader is on epub.js's locations scale,
    // which differs from the server's spine stats.
    /// Your position as an EPUB CFI, for `epub`. May be left out. When present, the server
    /// works out the fraction from it and ignores `ebook_fraction`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epub_cfi: Option<String>,
    /// The audio file you're playing, for `audio`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_book_file_id: Option<i64>,
    /// Your position in seconds from the start of `audio_book_file_id`. Required for
    /// `audio`, and must not be negative.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_seconds: Option<f64>,
}

impl DeclareSyncPoint {
    /// Boundary validation: the declaring surface must name its own
    /// position in its own coordinates.
    pub fn validate(&self) -> Result<(), String> {
        match self.format {
            ProgressFormat::Epub => match self.ebook_fraction {
                Some(f) if (0.0..=1.0).contains(&f) => Ok(()),
                Some(_) => Err("ebook_fraction must be within 0..=1".into()),
                None => Err("a reading declaration needs ebook_fraction".into()),
            },
            ProgressFormat::Audio => match self.audio_seconds {
                Some(s) if s >= 0.0 => Ok(()),
                Some(_) => Err("audio_seconds must be non-negative".into()),
                None => Err("a listening declaration needs audio_seconds".into()),
            },
        }
    }
}

/// Whether `POST /api/books/{uuid}/cross-format-follow` turns follow mode on or off.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetFollowMode {
    pub enabled: bool,
}

impl ConfirmCrossFormatLink {
    /// Boundary validation: narrations needs a primary; an order list
    /// must not repeat ids.
    pub fn validate(&self) -> Result<(), String> {
        if self.mode == CrossFormatLinkMode::Narrations && self.primary_book_file_id.is_none() {
            return Err("narrations mode requires a primary narration".into());
        }
        if let Some(order) = &self.audio_order {
            let mut seen = std::collections::HashSet::new();
            if !order.iter().all(|id| seen.insert(id)) {
                return Err("audio order must not repeat files".into());
            }
        }
        Ok(())
    }
}

/// Query parameters of `GET /api/books/{uuid}/cross-format-resume`.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct CrossFormatResumeQuery {
    /// The format you want to resume in. The position in the other format is mapped onto
    /// it.
    pub target: ProgressFormat,
    /// Set to `cfi` to also get the mapped point as an EPUB CFI in the candidate's
    /// `epub_cfi`, when `target` is `epub`. This opens the book's EPUB, so it is slower.
    /// Any other value is ignored.
    #[serde(default)]
    pub derive: Option<String>,
}
