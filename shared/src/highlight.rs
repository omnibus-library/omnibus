//! Highlight annotation wire types shared between web and mobile clients, plus the
//! pieces every annotation route shares: the list order and the client-stamped create.
//!
//! The five highlight colors match the CHECK constraint on
//! `annotations.color` (migration 0059, formerly `highlights` in 0017).

use serde::{Deserialize, Serialize};

/// A highlight's color, one of five.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum HighlightColor {
    Amber,
    Green,
    Blue,
    Rose,
    Violet,
}

impl HighlightColor {
    /// Lowercase storage/wire token for this color (matches migration 0017).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Amber => "amber",
            Self::Green => "green",
            Self::Blue => "blue",
            Self::Rose => "rose",
            Self::Violet => "violet",
        }
    }

    /// Parse a lowercase token back into a color, `None` if unrecognized.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "amber" => Some(Self::Amber),
            "green" => Some(Self::Green),
            "blue" => Some(Self::Blue),
            "rose" => Some(Self::Rose),
            "violet" => Some(Self::Violet),
            _ => None,
        }
    }
}

impl std::fmt::Display for HighlightColor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// `PartialEq` but not `Eq`: `percent_through_book` is a float.
/// A highlighted passage in an ebook, with an optional note.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct Highlight {
    pub id: i64,
    pub book_uuid: String,
    // A Kobo highlight's CFI is derived at ingest, else at the boot backfill.
    /// The highlighted range, as an EPUB range CFI. For a highlight made on a Kobo, the
    /// server works it out from the Kobo's own location. Null while that fails. A client
    /// can list such a highlight but can't place it in the text.
    #[serde(default)]
    pub epub_cfi_range: Option<String>,
    pub color: HighlightColor,
    /// The note on the highlight. Null when it has none.
    pub note: Option<String>,
    /// The highlighted text. Null for a few highlights made by old versions of Omnibus.
    #[serde(default)]
    pub text: Option<String>,
    /// The id the creating device gave the highlight. Null when the device sent none, and
    /// for highlights made by old versions of Omnibus.
    #[serde(default)]
    pub client_id: Option<String>,
    /// When the highlight was made, in Unix seconds.
    pub created_at: i64,
    // Null only on a value a client built itself.
    /// The same moment as `created_at`, as an ISO 8601 string in UTC.
    #[serde(default)]
    pub created_at_iso: Option<String>,
    /// The 0-based index of the spine document the highlight is in, as
    /// `GET /api/ebooks/{uuid}/chapters` numbers them. Null when the highlight has no
    /// `epub_cfi_range` or the server can't read it.
    #[serde(default)]
    pub spine_index: Option<i64>,
    /// The title of the chapter the highlight is in, from the book's table of contents.
    /// Null when the server doesn't know the book's chapters.
    #[serde(default)]
    pub chapter_title: Option<String>,
    /// How far through the book the highlight is, from 0 to 100. It measures to the start of
    /// the spine document the highlight is in, not to the highlight itself.
    #[serde(default)]
    pub percent_through_book: Option<f64>,
}

/// A new highlight, as `POST /api/highlights` takes it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateHighlight {
    pub book_uuid: String,
    /// The highlighted range, as an EPUB range CFI, up to 4,096 characters.
    pub epub_cfi_range: String,
    pub color: HighlightColor,
    /// The highlighted text, up to 8,192 characters. May be left out.
    #[serde(default)]
    pub text: Option<String>,
    /// An id the device makes up for the highlight, such as a UUID, up to 64 characters. The
    /// `/api/highlights/{id}` routes accept it in place of `id`, so an offline client can
    /// use the highlight before the server has numbered it. Sending the same `client_id`
    /// again returns the highlight already stored instead of making a second one.
    #[serde(default)]
    pub client_id: Option<String>,
}

impl CreateHighlight {
    /// Maximum length (in chars) of an EPUB CFI range string. A real CFI
    /// rarely exceeds a few hundred bytes; 4 KiB is a generous ceiling that
    /// stops an authed client from persisting megabyte-sized blobs per row.
    pub const EPUB_CFI_RANGE_MAX_LEN: usize = 4096;

    /// Maximum length (in chars) of the stored highlighted text. A single
    /// selection is at most a few paragraphs; 8 KiB is a generous ceiling.
    pub const TEXT_MAX_LEN: usize = 8192;

    /// Maximum length (in chars) of a client-minted annotation id. Clients
    /// send a UUID (36 chars); the cap leaves room for a prefixed scheme
    /// without letting an authed client index arbitrary blobs.
    pub const CLIENT_ID_MAX_LEN: usize = 64;

    /// Validate field lengths and required-ness. Call at the handler boundary before
    /// persisting so over-long inputs surface as 400 instead of falling through to the
    /// DB. Caps count Unicode scalar values (`chars`), like `MetadataOverrides::validate`.
    pub fn validate(&self) -> Result<(), String> {
        if self.book_uuid.trim().is_empty() {
            return Err("book_uuid is required".into());
        }
        if self.epub_cfi_range.trim().is_empty() {
            return Err("epub_cfi_range is required".into());
        }
        if self.epub_cfi_range.chars().count() > Self::EPUB_CFI_RANGE_MAX_LEN {
            return Err(format!(
                "epub_cfi_range exceeds {} characters",
                Self::EPUB_CFI_RANGE_MAX_LEN
            ));
        }
        if let Some(ref text) = self.text {
            if text.chars().count() > Self::TEXT_MAX_LEN {
                return Err(format!("text exceeds {} characters", Self::TEXT_MAX_LEN));
            }
        }
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
        Ok(())
    }
}

/// The note `PATCH /api/highlights/{id}/note` puts on a highlight.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UpdateHighlightNote {
    /// The note, up to 4,096 characters. Null or absent removes the note.
    pub note: Option<String>,
}

impl UpdateHighlightNote {
    /// Maximum length (in chars) of a highlight note — 4 KiB cap that lets
    /// the API boundary reject megabyte payloads up front.
    pub const NOTE_MAX_LEN: usize = 4096;

    /// Validate the note length. `None` clears the note and is always
    /// permitted. Returns `Err` with a human-readable message when the
    /// cap is exceeded.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(ref note) = self.note {
            if note.chars().count() > Self::NOTE_MAX_LEN {
                return Err(format!("note exceeds {} characters", Self::NOTE_MAX_LEN));
            }
        }
        Ok(())
    }
}

/// The color `PATCH /api/highlights/{id}/color` gives a highlight.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UpdateHighlightColor {
    pub color: HighlightColor,
}

/// Query parameters of the highlight and bookmark lists.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct AnnotationOrderQuery {
    /// `position` (the default) lists them in reading order through the book, with any the
    /// server can't place last. `chronological` (or `created`) lists them oldest first. Any
    /// other value means `position`.
    pub order: Option<String>,
}

/// A create body plus the time the device made the item: the wrapped body's fields and
/// `client_created_at`, side by side in one JSON object. Highlight, bookmark and journal
/// creates take this shape, so an offline client that sends a create later keeps the time
/// of the gesture.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ClientStamped<T> {
    #[serde(flatten)]
    pub body: T,
    /// When the device made the item, in Unix seconds. The server uses its own clock when
    /// this is absent or in the future.
    #[serde(default)]
    pub client_created_at: Option<i64>,
}

impl<T> ClientStamped<T> {
    /// Reject a negative `client_created_at`; handlers answer 400.
    pub fn validate_stamp(&self) -> Result<(), String> {
        if self.client_created_at.is_some_and(|ts| ts < 0) {
            return Err("client_created_at must be non-negative".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

impl Highlight {
    /// Fill [`Self::created_at_iso`] from the epoch already on the row.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.created_at_iso = Some(crate::to_iso8601(self.created_at));
        self
    }
}
