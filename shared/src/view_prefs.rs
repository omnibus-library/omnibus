//! Library-view preferences (sort, view mode, filters) persisted per library.
//! The filter shape itself is [`crate::view_filters`].
//!
//! Lives here — and not in `frontend/` — so a future server-backed per-user
//! prefs endpoint can reuse the shape verbatim. For now persistence is
//! localStorage on web and in-memory on mobile (see `frontend/src/view_prefs.rs`).

use serde::{Deserialize, Serialize};

use crate::view_filters::ViewFilters;

#[cfg(test)]
mod tests;

/// How a library list is laid out: as a table or as a grid of covers.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    Table,
    #[default]
    Grid,
}

/// The order to list books in.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    #[default]
    Title,
    Author,
    Series,
    /// By the book's `modified` time.
    LastUpdated,
    /// By the book's `added_at` time.
    NewestAdded,
    /// By the last time anyone rated the book, published a journal entry on it, changed
    /// its read status, added it, edited its metadata or cover, or checked in a physical
    /// copy.
    RecentlyInteracted,
}

impl SortKey {
    /// Stable wire token — matches the serde `snake_case` rename — used in the
    /// REST `?sort=` query and the grid sort dropdown. Single source of truth
    /// so the server query string, the client toolbar, and the cursor axis all
    /// agree.
    pub fn as_wire(self) -> &'static str {
        match self {
            SortKey::Title => "title",
            SortKey::Author => "author",
            SortKey::Series => "series",
            SortKey::LastUpdated => "last_updated",
            SortKey::NewestAdded => "newest_added",
            SortKey::RecentlyInteracted => "recently_interacted",
        }
    }

    /// Parse a [`SortKey`] from its [`as_wire`](Self::as_wire) token. `None`
    /// for an unrecognized value (caller falls back to the default).
    pub fn from_wire(s: &str) -> Option<Self> {
        Some(match s {
            "title" => SortKey::Title,
            "author" => SortKey::Author,
            "series" => SortKey::Series,
            "last_updated" => SortKey::LastUpdated,
            "newest_added" => SortKey::NewestAdded,
            "recently_interacted" => SortKey::RecentlyInteracted,
            _ => return None,
        })
    }
}

/// The direction of a `SortKey` order: ascending or descending.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    #[default]
    Asc,
    Desc,
}

impl SortDir {
    /// Stable wire token (matches the serde `lowercase` rename) for the REST
    /// `?dir=` query.
    pub fn as_wire(self) -> &'static str {
        match self {
            SortDir::Asc => "asc",
            SortDir::Desc => "desc",
        }
    }
}

/// One library's saved view settings: layout, sort order and filter.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ViewPrefs {
    pub view_mode: ViewMode,
    pub sort_key: SortKey,
    pub sort_dir: SortDir,
    #[serde(default)]
    pub filters: ViewFilters,
    /// Whether the filter panel is open. Defaults to false.
    #[serde(default)]
    pub filters_open: bool,
}

/// How to order the series or shelves list: by name, or by book count with the most
/// books first.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum IndexSort {
    #[default]
    Name,
    BookCount,
}

// Its tokens match `IndexSort`'s, so a choice stored before `Recent` existed
// still parses.
/// How to order the authors list: by name, by book count, or by the authors you read
/// most recently.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum AuthorSort {
    #[default]
    Name,
    BookCount,
    Recent,
}

/// The saved orders of the authors, series and shelves lists.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct DiscoveryPrefs {
    #[serde(default)]
    pub authors_sort: AuthorSort,
    #[serde(default)]
    pub series_sort: IndexSort,
    #[serde(default)]
    pub shelves_sort: IndexSort,
}
