//! Wire types for the library-cleanup dedup-suggestion surface, persisted by
//! the `dedup_suggestions` / `cleanup_log` / `entity_aliases` tables. Free of
//! server-only dependencies so it compiles under both the `web` and
//! `mobile` frontend feature gates.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// What a cleanup suggestion is about: an author, a series, a tag or a book's title.
// The same token is stored in `dedup_suggestions.kind` and `entity_aliases.kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum CleanupKind {
    /// Two or more author records that name the same person.
    Author,
    /// Two or more series records that name the same series.
    Series,
    /// A tag-vocabulary entry (merge two tags, or split one into several).
    Tag,
    /// A book title that normalizes to a form the metadata should adopt.
    BookTitle,
}

impl CleanupKind {
    /// The lowercase token persisted in `dedup_suggestions.kind` and
    /// `entity_aliases.kind`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Author => "author",
            Self::Series => "series",
            Self::Tag => "tag",
            Self::BookTitle => "book_title",
        }
    }

    /// Parse a persisted/wire token; `None` if unrecognized.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "author" => Self::Author,
            "series" => Self::Series,
            "tag" => Self::Tag,
            "book_title" => Self::BookTitle,
            _ => return None,
        })
    }
}

/// What a cleanup suggestion proposes doing.
// The same token is stored in `dedup_suggestions.action`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum CleanupAction {
    /// Combine two or more entities into one (author/series/tag merges).
    Merge,
    /// Break one entity into several (a tag whose members diverge).
    Split,
    /// Adopt a normalized name/title in place (book-title normalization).
    Rename,
    /// Remove an entity outright (e.g. an orphaned tag).
    Delete,
}

impl CleanupAction {
    /// The lowercase token persisted in `dedup_suggestions.action`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Split => "split",
            Self::Rename => "rename",
            Self::Delete => "delete",
        }
    }

    /// Parse a persisted/wire token; `None` if unrecognized.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "merge" => Self::Merge,
            "split" => Self::Split,
            "rename" => Self::Rename,
            "delete" => Self::Delete,
            _ => return None,
        })
    }
}

/// Where a cleanup suggestion stands in review.
// Mirrors the CHECK constraint on `dedup_suggestions.decision`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    /// Not reviewed yet. Every new suggestion starts here.
    #[default]
    Pending,
    /// Reviewed and approved. The change has been applied.
    Accepted,
    /// Reviewed and dismissed. The same suggestion isn't offered again.
    Rejected,
}

impl Decision {
    /// The lowercase token persisted in `dedup_suggestions.decision`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }

    /// Parse a persisted/wire token; `None` if unrecognized.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "pending" => Self::Pending,
            "accepted" => Self::Accepted,
            "rejected" => Self::Rejected,
            _ => return None,
        })
    }
}

/// How many cleanup suggestions are in each review state.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CleanupCounts {
    pub pending: i64,
    pub accepted: i64,
    pub rejected: i64,
}

/// One kind's suggestions counted by review state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CleanupKindCounts {
    /// The kind of record the suggestions are about.
    pub kind: CleanupKind,
    /// How many of that kind's suggestions are in each review state.
    pub counts: CleanupCounts,
}

/// A reviewer's decision on one cleanup suggestion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CleanupDecisionRequest {
    /// `accepted` applies the suggestion and `rejected` dismisses it. `pending` is refused.
    pub decision: Decision,
    /// The reviewer's own wording, used in place of the proposed one. Only a book-title
    /// rename takes it; for any other suggestion it is refused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// What a cleanup decision did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CleanupDecisionOutcome {
    /// The change an accept applied, which `POST /api/admin/cleanup/undo/{log_id}` reverses.
    /// Null for a reject, which changes nothing.
    pub log_id: Option<i64>,
}

/// One cleanup suggestion with the names and counts to show it for review.
/// `secondary_name` and `photo_url` are null when they don't apply: a tag split has no
/// single other name, and only author suggestions can have a photo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SuggestionCard {
    pub id: i64,
    pub kind: CleanupKind,
    pub action: CleanupAction,
    pub decision: Decision,
    /// The name the suggestion centres on: the record a merge keeps, the tag being
    /// split, the record being deleted, or a book's current title.
    pub primary_name: String,
    /// The suggestion's second name, where it has one: the proposed title on a rename,
    /// or the record folding away in a two-way merge. Null for a split, a delete, and
    /// a merge of three or more records, which `source_names` lists instead.
    pub secondary_name: Option<String>,
    /// Every name a merge would fold into `primary_name`. Empty for the other actions.
    #[serde(default)]
    pub source_names: Vec<String>,
    /// The tags a split would produce, in the order they appear in the original. Empty
    /// for every other action.
    #[serde(default)]
    pub proposed_parts: Vec<String>,
    /// How many library books are affected if the suggestion is applied.
    pub book_count: i64,
    /// Relative URL of the author's cached photo. Null for other kinds and for an
    /// author without one.
    pub photo_url: Option<String>,
    /// Unix seconds the suggestion was detected.
    pub created_at: i64,
}
