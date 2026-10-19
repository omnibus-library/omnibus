//! Physical Check-In wire types shared between web (`#[server]`) and mobile
//! (`reqwest`): a library-wide physical copy of a book and a per-user physical
//! wishlist entry. Both reference a book by its durable `books.uuid`.

use serde::{Deserialize, Serialize};

// The change rule lives in `Self::can_change`.
/// A physical copy of a book. Every user can see it, but only the reader who checked it
/// in, or an admin, can change its note or remove it. A book can have many copies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct PhysicalCopy {
    pub id: i64,
    pub book_uuid: String,
    /// The ISBN scanned for this copy. Null when the copy was added without one.
    pub isbn: Option<String>,
    /// The id of the user who checked the copy in. Null once that account is deleted.
    pub added_by_user_id: Option<i64>,
    /// That user's display name, or their username when they have none. Absent once the
    /// account is deleted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_by_name: Option<String>,
    pub checked_in_at: i64,
    /// When the copy was checked in, as an ISO 8601 UTC timestamp. It is the same moment
    /// as `checked_in_at`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_in_at_iso: Option<String>,

    /// A free-text note about the copy, such as its edition or publisher.
    pub note: Option<String>,
}

impl PhysicalCopy {
    /// Fill [`Self::checked_in_at_iso`] from the epoch already on the row.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.checked_in_at_iso = Some(crate::to_iso8601(self.checked_in_at));
        self
    }

    /// Whether `viewer` may edit this copy's note or remove it: the reader who
    /// filed it, or an admin — the shelf rule. Removal is destructive and the
    /// copy is the filer's record, so `can_edit` alone does not reach it; a
    /// copy whose filer's account is gone is admin-only.
    pub fn can_change(&self, viewer_id: i64, is_admin: bool) -> bool {
        is_admin || self.added_by_user_id == Some(viewer_id)
    }
}

// Persisted as the `source` column.
/// Where a wishlist entry was added from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub enum WishlistSource {
    /// Added after reading a barcode with the camera.
    Scan,
    /// Added from a book's detail page.
    Detail,
    /// Added after an ISBN was typed by hand rather than scanned.
    Manual,
    /// Added after a title search. The ISBN came from a provider, not the reader.
    Search,
}

impl WishlistSource {
    /// The stored `source` string (matches the migration's CHECK constraint).
    pub fn as_str(self) -> &'static str {
        match self {
            WishlistSource::Scan => "scan",
            WishlistSource::Detail => "detail",
            WishlistSource::Manual => "manual",
            WishlistSource::Search => "search",
        }
    }

    /// Parse a stored `source` string; `None` for an unrecognized value.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "scan" => Some(WishlistSource::Scan),
            "detail" => Some(WishlistSource::Detail),
            "manual" => Some(WishlistSource::Manual),
            "search" => Some(WishlistSource::Search),
            _ => None,
        }
    }
}

/// A new note for a physical copy, up to 4096 characters. Null, left out or blank clears
/// the note.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UpdateCopyNoteRequest {
    #[serde(default)]
    pub note: Option<String>,
}

impl UpdateCopyNoteRequest {
    /// Maximum length (in chars) of a physical copy's free-text note. Mirrors
    /// `omnibus_shared::highlight::UpdateHighlightNote::NOTE_MAX_LEN`.
    pub const NOTE_MAX_LEN: usize = 4096;

    /// Validate the note length. `None` clears the note and is always
    /// permitted. Returns `Err` with a human-readable message when the cap is
    /// exceeded. Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(ref note) = self.note {
            if note.chars().count() > Self::NOTE_MAX_LEN {
                return Err(format!("note exceeds {} characters", Self::NOTE_MAX_LEN));
            }
        }
        Ok(())
    }
}

/// A book on one user's physical wishlist. Each book is on a user's wishlist at most
/// once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WishlistEntry {
    pub id: i64,
    pub user_id: i64,
    pub book_uuid: String,
    pub added_at: i64,
    pub source: WishlistSource,
}

/// What removing a wishlist entry did. A book with no file, no physical copy and no
/// other reader's wish goes with its last wishlist entry. `book_deleted` is then true,
/// and the book no longer exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WishlistRemoval {
    pub book_deleted: bool,
}

#[cfg(test)]
mod tests;
