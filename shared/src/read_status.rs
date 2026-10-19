//! Per-user read/unread state wire types shared between web and mobile clients.
//! A book carries one [`ReadStatus`] per user — `unread` / `reading` /
//! `finished` — settable from book detail without a journal entry; a missing
//! stored row reads as `Unread` everywhere. `finished` completions feed the
//! reading-stats aggregations alongside journal-sourced ones.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// Where one user is with a book: not started, reading, or finished.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum ReadStatus {
    /// Not started, or set back to unread. A book with no status set is unread.
    #[default]
    Unread,
    /// Being read. Saving a position sets it on a book that has no status.
    Reading,
    /// Read to the end. The reading stats count it as a finished book.
    Finished,
}

impl ReadStatus {
    /// The lowercase form persisted in the `book_read_status.status` column.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unread => "unread",
            Self::Reading => "reading",
            Self::Finished => "finished",
        }
    }

    /// Parse a persisted/wire token; `None` if unrecognized. Named `from_str`
    /// for symmetry with `as_str` — not the fallible `FromStr` trait.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "unread" => Self::Unread,
            "reading" => Self::Reading,
            "finished" => Self::Finished,
            _ => return None,
        })
    }

    /// Parse a column value, defaulting unrecognized strings to `Unread`
    /// (fail-open matches the column's CHECK + the "missing row = unread"
    /// convention).
    pub fn from_db(s: &str) -> Self {
        Self::from_str(s).unwrap_or(Self::Unread)
    }
}

/// The read status `PUT /api/read-status` sets for you on a book.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetReadStatus {
    pub book_uuid: String,
    pub status: ReadStatus,
}

impl SetReadStatus {
    /// Reject an empty or oversized `book_uuid`, mirroring the same cap
    /// applied to every other `book_uuid`-carrying request (e.g.
    /// `CheckInRequest::validate`). Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if self.book_uuid.trim().is_empty() {
            return Err("book_uuid is required".into());
        }
        if self.book_uuid.len() > crate::BOOK_UUID_MAX_LEN {
            return Err(format!(
                "book uuid must be ≤ {} bytes",
                crate::BOOK_UUID_MAX_LEN
            ));
        }
        Ok(())
    }
}

/// Your read status for a book, as the server stores it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ReadStatusRecord {
    pub book_uuid: String,
    pub status: ReadStatus,
    /// When the status last changed, in Unix seconds.
    pub updated_at: i64,
    // Absent only on a value a client built itself.
    /// The same moment as `updated_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at_iso: Option<String>,

    /// When the book became finished, in Unix seconds. Setting `finished` on a book that is
    /// already finished keeps the original time. Absent unless `status` is `finished`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
}

impl ReadStatusRecord {
    /// Fill [`Self::updated_at_iso`] from the epoch already on the record.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.updated_at_iso = Some(crate::to_iso8601(self.updated_at));
        self
    }
}
