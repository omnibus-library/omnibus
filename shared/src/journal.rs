//! Public per-book journal wire types shared between web and mobile clients. A
//! journal entry is a free-form markdown note on a book; entries are public, so
//! every authenticated user sees every user's entries for a book, attributed by
//! `author_name`, and only the owner may edit or delete. The body renders to
//! sanitized HTML server-side, with the raw source riding along for editing.

use serde::{Deserialize, Serialize};

/// Maximum byte length of a journal entry's markdown source.
pub const BODY_MAX_LEN: usize = 64 * 1024;

/// Inclusive upper bound for the optional per-entry reading-progress percent.
pub const PROGRESS_MAX: u8 = 100;

/// Shared validation for a journal body + optional progress. Handlers translate
/// `Err(_)` into a 400 / 422.
fn validate_body(body_md: &str, progress: Option<u8>) -> Result<(), String> {
    if body_md.trim().is_empty() {
        return Err("journal entry cannot be empty".into());
    }
    if body_md.len() > BODY_MAX_LEN {
        return Err(format!(
            "journal entry must be {BODY_MAX_LEN} bytes or fewer"
        ));
    }
    if let Some(p) = progress {
        if p > PROGRESS_MAX {
            return Err(format!("progress must be between 0 and {PROGRESS_MAX}"));
        }
    }
    Ok(())
}

/// Who can see a journal entry. A draft is visible only to its author. A published entry,
/// the default, is visible to every user.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum JournalStatus {
    Draft,
    #[default]
    Published,
}

impl JournalStatus {
    /// The lowercase form persisted in the `journal_entries.status` column.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Published => "published",
        }
    }

    /// Parse the persisted column value; anything unrecognised reads as
    /// `Published` (fail-open matches the column's CHECK + default).
    pub fn from_db(s: &str) -> Self {
        match s {
            "draft" => Self::Draft,
            _ => Self::Published,
        }
    }
}

/// A Markdown note a user wrote about a book.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct JournalEntry {
    pub id: i64,
    pub book_uuid: String,
    /// The id of the user who wrote the entry.
    pub author_id: i64,
    /// The author's display name, or their username when they have none.
    pub author_name: String,
    /// Whether the author has an avatar. `GET /api/users/{user_id}/avatar` serves it.
    #[serde(default)]
    pub author_has_avatar: bool,
    /// The entry's Markdown source, for editing.
    pub body_md: String,
    /// The entry rendered to HTML, with unsafe markup removed.
    pub body_html: String,
    /// How far through the book the author was, from 0 to 100. Null when they didn't say.
    /// An entry at 100 counts the book as finished in the author's reading stats.
    pub progress: Option<u8>,
    #[serde(default)]
    pub status: JournalStatus,
    /// The id the creating device gave the entry. Null when the device sent none, and for
    /// entries written with old versions of Omnibus.
    #[serde(default)]
    pub client_id: Option<String>,
    /// When the entry was written, in Unix seconds.
    pub created_at: i64,
    /// When the entry was last edited, in Unix seconds.
    pub updated_at: i64,
    // Absent only on a value a client built itself.
    /// The same moment as `created_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at_iso: Option<String>,
    // Absent only on a value a client built itself.
    /// The same moment as `updated_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at_iso: Option<String>,
}

impl JournalEntry {
    /// Fill the ISO siblings from the epochs already on the entry.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.created_at_iso = Some(crate::to_iso8601(self.created_at));
        self.updated_at_iso = Some(crate::to_iso8601(self.updated_at));
        self
    }
}

/// A new journal entry, as `POST /api/journals` takes it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateJournalEntry {
    pub book_uuid: String,
    /// The entry's Markdown source. It must not be blank, and can be up to 65,536 bytes.
    pub body_md: String,
    /// How far through the book you are, from 0 to 100. May be null.
    pub progress: Option<u8>,
    /// May be left out, which publishes the entry.
    #[serde(default)]
    pub status: JournalStatus,
    /// An id the device makes up for the entry, such as a UUID, up to 64 characters. The
    /// `/api/journals/{id}` routes accept it in place of `id`, so an offline client can
    /// edit or delete the entry before the server has numbered it. Sending the same
    /// `client_id` again returns the entry already stored instead of making a second one.
    #[serde(default)]
    pub client_id: Option<String>,
}

impl CreateJournalEntry {
    /// Maximum length (in chars) of a client-minted entry id. Mirror of
    /// [`crate::highlight::CreateHighlight::CLIENT_ID_MAX_LEN`].
    pub const CLIENT_ID_MAX_LEN: usize = crate::highlight::CreateHighlight::CLIENT_ID_MAX_LEN;

    /// Reject an empty uuid, an empty/oversized body, or out-of-range progress.
    pub fn validate(&self) -> Result<(), String> {
        if self.book_uuid.trim().is_empty() {
            return Err("book_uuid is required".into());
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
        validate_body(&self.body_md, self.progress)
    }
}

/// The multipart form `POST /api/journals/images` takes: one part, named `image`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct JournalImageForm {
    /// The image: JPEG, PNG, GIF or WebP, up to 10 MiB. The part's own `Content-Type` must
    /// be an `image/*` type other than SVG.
    #[cfg_attr(feature = "openapi", schema(value_type = String, format = Binary))]
    pub image: Vec<u8>,
}

/// An uploaded journal image.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct JournalImageUpload {
    /// The image's URL. Put it in an entry's Markdown as `![caption](url)`.
    pub url: String,
}

/// The new content `PATCH /api/journals/{id}` gives one of your journal entries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UpdateJournalEntry {
    /// The entry's new Markdown source. It must not be blank, and can be up to 65,536 bytes.
    pub body_md: String,
    /// How far through the book you are, from 0 to 100. Null clears it.
    pub progress: Option<u8>,
    /// The entry's new status, such as `published` to publish a draft. Null or absent keeps
    /// the current status.
    #[serde(default)]
    pub status: Option<JournalStatus>,
}

impl UpdateJournalEntry {
    /// Reject an empty/oversized body or out-of-range progress.
    pub fn validate(&self) -> Result<(), String> {
        validate_body(&self.body_md, self.progress)
    }
}

#[cfg(test)]
mod tests;
