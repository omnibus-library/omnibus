//! Reading and listening progress wire types, used by `POST /api/progress`,
//! `GET /api/progress/{uuid}`, and `POST /api/progress/sessions`. The
//! `ProgressFormat` discriminator selects which position field is meaningful,
//! so one endpoint covers both reading (EPUB CFI) and listening (audio seconds)
//! positions.

use serde::{Deserialize, Serialize};

use crate::highlight::CreateHighlight;
use crate::EbookMetadata;

#[cfg(test)]
mod tests;

/// Maximum number of `SessionReport`s accepted per session-batch upload.
///
/// Enforced at both API boundaries (`POST /api/progress/sessions` and the web
/// RPC `rpc_record_sessions`) to bound per-request DB work and write-lock hold
/// time. Not runtime-configurable.
pub const SESSION_BATCH_CAP: usize = 500;

/// Maximum length (in chars) of an `epub_cfi` position string. Defined in
/// terms of `CreateHighlight::EPUB_CFI_RANGE_MAX_LEN` — both hold the same
/// kind of value — so the two ceilings can't drift apart.
pub const EPUB_CFI_MAX_LEN: usize = CreateHighlight::EPUB_CFI_RANGE_MAX_LEN;

/// Position anchor for a comic (CBZ) page, stored in the `epub_cfi` slot of an
/// `Epub`-format progress row. A page index is not a CFI, so the `comic-page:`
/// prefix makes the value self-describing; every client round-trips it through
/// these two helpers rather than inventing an encoding. The percent alongside
/// is the cross-surface half, same as a Kobo's percent-only write.
pub fn comic_page_anchor(page: usize) -> String {
    format!("comic-page:{page}")
}

/// Parse a [`comic_page_anchor`] back to its 0-based page index. `None` for
/// anything else — including a real EPUB CFI — so callers can fall back to
/// `progress_percent` without misreading a foreign position.
pub fn parse_comic_page_anchor(anchor: &str) -> Option<usize> {
    anchor.strip_prefix("comic-page:")?.parse().ok()
}

/// Which kind of position a progress record holds. `epub` is a reading position in any
/// ebook, comics and PDFs included. `audio` is a listening position in an audiobook.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum ProgressFormat {
    Epub,
    Audio,
}

impl ProgressFormat {
    /// The wire token this serializes as. Anything composing an identifier
    /// from a format takes this rather than the `Debug` rendering, so the
    /// value is a declared contract rather than a side effect of a derive.
    pub fn as_str(self) -> &'static str {
        match self {
            ProgressFormat::Epub => "epub",
            ProgressFormat::Audio => "audio",
        }
    }
}

/// A reading or listening position, as `POST /api/progress` takes it. `format` decides
/// which position fields apply.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProgressUpdate {
    pub book_uuid: String,
    pub format: ProgressFormat,
    /// The reading position, up to 4,096 characters. It is an EPUB CFI, or `comic-page:N` in
    /// a comic and `pdf-page:N` in a PDF, where N is the 0-based page. An `epub` update
    /// needs this or `progress_percent`. Must be absent for `audio`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epub_cfi: Option<String>,
    /// The listening position, in seconds from the start of the audio file. Required for
    /// `audio`, and must be absent for `epub`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_position_seconds: Option<f64>,
    /// How far through the whole book, from 0 to 100. Unlike a CFI, it means the same thing
    /// on every device. A Kobo sends only this, so for `epub` it can stand in for
    /// `epub_cfi`. Must be absent for `audio`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<i64>,
    // A string rather than a JSON value keeps `shared` free of a `serde_json`
    // runtime dependency. The server may translate it to and from a CFI
    // (`db::kobo_position`).
    /// A Kobo e-reader's own location object, as a JSON string. The Kobo sync stores it so
    /// the Kobo can resume at the exact spot. Other clients leave it out. Must be absent for
    /// `audio`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kobo_location: Option<String>,
    /// The file the position was taken in, for a book with more than one file of the
    /// format, such as two narrations of one audiobook. It is the `book_file_id` that
    /// `GET /api/audiobooks/{uuid}/manifest` returns. Left out, the server uses the file the
    /// manifest serves by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_file_id: Option<i64>,
    /// When the device recorded this position, in Unix seconds. The server keeps the
    /// position with the newest such time, not the one that arrived last. Left out, the
    /// server uses the time the update arrives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_updated_at: Option<i64>,
}

impl ProgressUpdate {
    /// Reject empty UUIDs, missing format-specific positions, and a
    /// negative `client_updated_at`. Mirrors `MetadataOverrides::validate`
    /// — handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if self.book_uuid.trim().is_empty() {
            return Err("book_uuid is required".into());
        }
        if self.client_updated_at.is_some_and(|ts| ts < 0) {
            return Err("client_updated_at must be non-negative".into());
        }
        // Checked before the format split so an out-of-range percent is a 400
        // rather than falling through to the row CHECK as a 500.
        if self
            .progress_percent
            .is_some_and(|p| !(0..=100).contains(&p))
        {
            return Err("progress_percent must be between 0 and 100".into());
        }
        if self.book_file_id.is_some_and(|id| id <= 0) {
            return Err("book_file_id must be positive".into());
        }
        // Reject the non-discriminated field at the API boundary so a
        // cross-format payload (e.g. `{format:"epub", audio_position_seconds:…}`)
        // returns 400 instead of falling through to the migration 0013 CHECK
        // constraint and surfacing as a 500.
        match self.format {
            ProgressFormat::Epub => {
                // A present-but-blank CFI is rejected outright rather than
                // ignored: the store binds blanks as NULL, so letting one
                // through would silently clear a stored anchor instead of
                // recording the position the client thought it sent.
                if self
                    .epub_cfi
                    .as_deref()
                    .is_some_and(|s| s.trim().is_empty())
                {
                    return Err("epub_cfi must not be blank".into());
                }
                // A CFI *or* a percent is enough. A Kobo has no CFI to give
                // (its location is a `KoboSpan`, not a CFI), so requiring one
                // would lock the device out of the progress store entirely.
                if self.epub_cfi.is_none() && self.progress_percent.is_none() {
                    return Err("format=epub requires epub_cfi or progress_percent".into());
                }
                if let Some(cfi) = &self.epub_cfi {
                    if cfi.chars().count() > EPUB_CFI_MAX_LEN {
                        return Err(format!("epub_cfi exceeds {EPUB_CFI_MAX_LEN} characters"));
                    }
                }
                if self.audio_position_seconds.is_some() {
                    return Err("audio_position_seconds must not be set for format=epub".into());
                }
            }
            ProgressFormat::Audio => {
                let Some(pos) = self.audio_position_seconds else {
                    return Err("audio_position_seconds is required for format=audio".into());
                };
                if !pos.is_finite() || pos < 0.0 {
                    return Err(
                        "audio_position_seconds must be a non-negative finite number".into(),
                    );
                }
                if self.epub_cfi.is_some() {
                    return Err("epub_cfi must not be set for format=audio".into());
                }
                if self.progress_percent.is_some() {
                    return Err("progress_percent must not be set for format=audio".into());
                }
                if self.kobo_location.is_some() {
                    return Err("kobo_location must not be set for format=audio".into());
                }
            }
        }
        Ok(())
    }
}

/// Your position in one format of a book, as the server stores it. Only the position
/// fields of `format` are set.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ProgressRecord {
    pub book_uuid: String,
    pub format: ProgressFormat,
    /// The reading position of an `epub` record, in the forms `ProgressUpdate` takes. Null
    /// for `audio`, and for an `epub` record that holds only a percent.
    pub epub_cfi: Option<String>,
    /// The listening position of an `audio` record, in seconds from the start of the audio
    /// file. Null for `epub`.
    pub audio_position_seconds: Option<f64>,
    // `#[serde(default)]`, unlike its siblings here, so a payload from a server
    // predating this field still decodes.
    /// How far through the whole book, from 0 to 100. On `GET /api/progress/{uuid}` and
    /// `GET /api/progress/recent`, an `audio` record carries one computed from its
    /// position. When an `epub` position arrives with only a CFI, the server works out the
    /// percent shortly after, so it can be null for a moment.
    #[serde(default)]
    pub progress_percent: Option<i64>,
    /// A Kobo e-reader's own location object, as a JSON string. Only the Kobo sync reads it.
    #[serde(default)]
    pub kobo_location: Option<String>,
    /// The file the position was taken in. On `GET /api/progress/{uuid}` and
    /// `GET /api/progress/recent`, an `audio` record names the file the position plays in:
    /// the file it was taken in, or the book's first audio file when that one is gone. It
    /// is null there when the book has no audio file left.
    #[serde(default)]
    pub book_file_id: Option<i64>,
    /// When the server received the position, in Unix seconds.
    pub updated_at: i64,
    /// When the device recorded the position, in Unix seconds. The newest one wins. The
    /// server uses its own clock when the update carried no time, and moves a time ahead of
    /// its clock back to it.
    pub client_updated_at: i64,
    /// The length of the whole audiobook in seconds, across all its files. Absent for
    /// `epub` records. Only `GET /api/progress/{uuid}` and `GET /api/progress/recent` fill
    /// it, so the `POST /api/progress` response leaves it out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_duration_seconds: Option<f64>,
    /// Where the position is in the book's chapters. Absent when the server can't place
    /// it, and from the `POST /api/progress` response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved: Option<ResolvedPosition>,
    /// A point CFI for an `epub` record that holds a percent but no CFI, such as one a Kobo
    /// wrote. A reader can open the book there instead of at the start. It never points
    /// past the stored percent. Only `GET /api/progress/{uuid}` fills it. Absent when
    /// `epub_cfi` is set or the server doesn't know the book's structure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_epub_cfi: Option<String>,
}

// Reported rather than withheld: a coarse answer a caller knows is coarse
// beats an absent block it fills in by guessing.
/// How far a client can trust the chapter a `ResolvedPosition` names.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum PositionConfidence {
    /// Placed against the book's real structure: a table of contents entry that has its
    /// spine document to itself, or chapter marks from the audio file.
    High,
    /// The best answer available, but coarse. The position was a percent mapped back onto
    /// the book, several table of contents entries share one spine document, or the audio
    /// marks stand for files rather than chapters.
    Low,
}

/// Where a stored position is in the book: its chapter, and how far through the chapter
/// and the book. The server works it out from the chapters `GET /api/ebooks/{uuid}/chapters`
/// lists, or from the audiobook's chapter marks. Each field but `confidence` is absent
/// when the book lacks the structure it needs, such as an EPUB with no table of contents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ResolvedPosition {
    /// The 0-based index of the spine document, as `GET /api/ebooks/{uuid}/chapters` numbers
    /// them. In a PDF it is the page. Absent for audio positions and comic pages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spine_index: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_title: Option<String>,
    // Deliberately not the stored 0-based `ebook_chapters.ordinal`: an
    // off-by-one here is the whole failure this block exists to end.
    /// The chapter's number, counting from 1, so it reads directly against
    /// `chapters_total`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_ordinal: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapters_total: Option<i64>,
    /// How far through the chapter, from 0 to 100. For an ebook, only
    /// `GET /api/progress/{uuid}` fills it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent_through_chapter: Option<i64>,
    /// How far through the whole book, from 0 to 100, on the same scale as
    /// `progress_percent` in `ProgressRecord`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent_through_book: Option<i64>,
    pub confidence: PositionConfidence,
}

// Returned whole rather than one format at a time: a reader 87% through the
// audiobook and 47% through the EPUB has one true place, which an EPUB-only
// answer would misreport.
/// Every position you have in one book, one per format, as `GET /api/progress/{uuid}`
/// returns it. The `format` query parameter narrows `records` to one entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookProgress {
    /// The uuid of the book the positions belong to. It differs from the uuid in the path
    /// when that book was merged into this one.
    pub book_uuid: String,
    /// One record per format you have a position in, the most recently recorded first.
    /// Empty when you have never opened the book.
    pub records: Vec<ProgressRecord>,
    /// The format of the record that is your true place. It is the record furthest through
    /// the book by whole-book percent, or the most recent when a record has no percent.
    /// Null only when `records` is empty.
    pub furthest: Option<ProgressFormat>,
    /// Whether you have linked this book's ebook and audiobook, so positions sync between
    /// them.
    #[serde(default)]
    pub linked: bool,
    /// Where to resume in the other format, for a linked book. It is mapped from your
    /// position in `furthest`. Absent when there is nothing newer to offer or the position
    /// can't be mapped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_format: Option<crate::cross_format::CrossFormatCandidate>,
}

/// A book to pick up where you left off, as `GET /api/progress/recent` returns it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ResumePoint {
    pub record: ProgressRecord,
    pub book: EbookMetadata,
    /// Whether you have linked this book's ebook and audiobook. A linked book appears once,
    /// for the format you used last.
    #[serde(default)]
    pub linked: bool,
    /// Where to resume in the other format, for a linked book. Absent when the other
    /// format's position is newer or the position can't be mapped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_format: Option<crate::cross_format::CrossFormatCandidate>,
    /// The 1-based part of the audiobook the saved position is in, from the audio file's
    /// own marks. Absent for `epub` records. A part is not a book chapter: a 65-chapter
    /// novel stored as a 4-part M4B has four parts. Book chapters are in `record.resolved`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_part: Option<i64>,
    /// How many parts the audiobook has. Absent for `epub` records.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_part_count: Option<i64>,
    /// Your saved playback speed for this book, such as 1.5. Absent for `epub` records and
    /// when you haven't saved one, which means 1x.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playback_rate: Option<f64>,
}

/// Which structural position a resume surface should name, chosen once here
/// so every surface makes the same call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StructuralPosition {
    /// A real book chapter, resolved server-side. `total` is absent for a
    /// book whose chapter list couldn't be counted.
    Chapter {
        ordinal: i64,
        total: Option<i64>,
        title: Option<String>,
    },
    /// A structural part of an audiobook timeline — the container's marks,
    /// which may be one per file rather than one per chapter. Rendered as a
    /// part so a four-file novel never reads as a four-chapter one.
    Part { ordinal: i64, total: Option<i64> },
}

impl ResumePoint {
    /// The structural position to show beside this card, or `None` when the book
    /// can name neither.
    ///
    /// A confidently resolved chapter wins; a `Low`-confidence block is demoted to
    /// the part readout, which is what it actually measured.
    pub fn structural_position(&self) -> Option<StructuralPosition> {
        if let Some(resolved) = &self.record.resolved {
            if resolved.confidence == PositionConfidence::High {
                if let Some(ordinal) = resolved.chapter_ordinal {
                    return Some(StructuralPosition::Chapter {
                        ordinal,
                        total: resolved.chapters_total,
                        title: resolved.chapter_title.clone(),
                    });
                }
            }
        }
        Some(StructuralPosition::Part {
            ordinal: self.audio_part?,
            total: self.audio_part_count,
        })
    }
}

/// One stretch of reading or listening, from opening a book to closing it.
/// `POST /api/progress/sessions` takes up to 500 of them at a time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionReport {
    pub book_uuid: String,
    pub format: ProgressFormat,
    /// When the session started, in Unix seconds.
    pub started_at: i64,
    /// When the session ended, in Unix seconds. Must not be before `started_at`.
    pub ended_at: i64,
    /// Seconds spent reading or listening in the session. Must not be negative.
    pub progress_units: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<i64>,
    /// An id the device makes up for the session, such as a UUID, up to 64 characters. A
    /// session whose `client_id` is already stored isn't stored again, so a client can
    /// resend a batch whose response it lost. Without one, a resent session is stored
    /// twice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// The device's offset from UTC in minutes when the session was recorded, east
    /// positive: `-420` for UTC-7, `330` for UTC+05:30. From -720 to 840. The time-of-day
    /// and weekday stats place the session by it, and leave out a session without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub utc_offset_minutes: Option<i64>,
    /// The device's IANA time zone when the session was recorded, such as
    /// `America/Los_Angeles`, up to 64 characters. It goes with `utc_offset_minutes`. The
    /// offset says what the clock read, and the zone says where. An offset of `-420` is Los
    /// Angeles in summer and Phoenix all year. The server stores the name without checking
    /// it.
    // Captured ahead of any reader: a zone cannot be recovered from an offset later.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
}

impl SessionReport {
    /// Maximum length (in chars) of a client-minted session id. Mirror of
    /// [`CreateHighlight::CLIENT_ID_MAX_LEN`].
    pub const CLIENT_ID_MAX_LEN: usize = CreateHighlight::CLIENT_ID_MAX_LEN;

    /// Lower bound (inclusive) on [`Self::utc_offset_minutes`] — UTC-12:00.
    pub const UTC_OFFSET_MIN_MINUTES: i64 = -12 * 60;
    /// Upper bound (inclusive) on [`Self::utc_offset_minutes`] — UTC+14:00,
    /// the eastern extreme of the real IANA span (Kiritimati).
    pub const UTC_OFFSET_MAX_MINUTES: i64 = 14 * 60;

    /// Maximum length (in chars) of [`Self::time_zone`]. The longest name in the
    /// IANA database is well under this; the bound exists so an unbounded string
    /// can't ride a batched route into a column, not to police the vocabulary —
    /// the server stores the name opaquely and never resolves it.
    pub const TIME_ZONE_MAX_LEN: usize = 64;

    /// Reject empty UUIDs, inverted time ranges, negative durations, and a
    /// malformed `client_id` before they reach the `reading_sessions` /
    /// `listening_sessions` tables — these rows feed future stats /
    /// year-in-review, so a single negative `progress_units` would skew
    /// aggregates indefinitely.
    pub fn validate(&self) -> Result<(), String> {
        if self.book_uuid.trim().is_empty() {
            return Err("book_uuid is required".into());
        }
        if self.started_at < 0 || self.ended_at < 0 {
            return Err("started_at and ended_at must be non-negative".into());
        }
        if self.ended_at < self.started_at {
            return Err("ended_at must be greater than or equal to started_at".into());
        }
        if self.progress_units < 0 {
            return Err("progress_units must be non-negative".into());
        }
        // Same ceiling as the annotation handles: this one indexes a batched
        // route, so an unbounded string would go straight into a unique
        // index once per report in the batch.
        if let Some(ref client_id) = self.client_id {
            if client_id.trim().is_empty() {
                return Err("client_id must not be blank".into());
            }
            if client_id.chars().count() > Self::CLIENT_ID_MAX_LEN {
                return Err(format!(
                    "client_id exceeds {} characters",
                    Self::CLIENT_ID_MAX_LEN
                ));
            }
        }
        // Bounded at the boundary rather than trusted: the offset is a
        // *shift applied to a timestamp*, so an absurd value doesn't produce a
        // wrong-looking row, it silently relabels the session's hour and
        // weekday in the aggregate.
        if let Some(offset) = self.utc_offset_minutes {
            if !(Self::UTC_OFFSET_MIN_MINUTES..=Self::UTC_OFFSET_MAX_MINUTES).contains(&offset) {
                return Err(format!(
                    "utc_offset_minutes must be between {} and {}",
                    Self::UTC_OFFSET_MIN_MINUTES,
                    Self::UTC_OFFSET_MAX_MINUTES
                ));
            }
        }
        // Bounded but not validated against the tz database: the server stores
        // the name opaquely, so an unrecognised one costs nothing, while a
        // vocabulary check here would reject a zone added to IANA after this
        // build shipped. A blank is rejected outright rather than stored as an
        // empty string, so "absent" has one representation.
        if let Some(ref zone) = self.time_zone {
            if zone.trim().is_empty() {
                return Err("time_zone must not be blank".into());
            }
            if zone.chars().count() > Self::TIME_ZONE_MAX_LEN {
                return Err(format!(
                    "time_zone exceeds {} characters",
                    Self::TIME_ZONE_MAX_LEN
                ));
            }
        }
        Ok(())
    }
}

/// The response of `POST /api/progress/sessions`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionsRecorded {
    /// How many sessions named a book the server knows; it drops the rest, so this can be
    /// less than the number sent. A session repeating a stored `client_id` counts here but
    /// isn't stored twice.
    pub recorded: usize,
}

/// Query parameters of `GET /api/progress/{uuid}`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct ProgressQuery {
    /// Return only the position in this format. Absent, every format you have a position
    /// in comes back.
    #[serde(default)]
    pub format: Option<ProgressFormat>,
}

/// Query parameters of `GET /api/progress/recent`.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct RecentProgressQuery {
    /// How many books to return, from 1 to 20. Defaults to 1; a value outside the range is
    /// moved to the nearest end.
    #[serde(default = "default_recent_limit")]
    pub limit: i64,
    /// Read another reader's books instead of your own. They must share their stats.
    pub user_id: Option<i64>,
}

fn default_recent_limit() -> i64 {
    1
}
