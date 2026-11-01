//! The library list's sort order on the wire: [`SortKey`] and [`SortDir`], with
//! the tokens the REST `?sort=` and `?dir=` queries carry.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

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
