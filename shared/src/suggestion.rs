//! Wire types for "Readers also enjoyed" suggestions.

use serde::{Deserialize, Serialize};

/// Base URL for outbound Hardcover book links (new tab).
const HARDCOVER_BOOK_BASE: &str = "https://hardcover.app/books/";

/// A book Hardcover suggests for readers of a library book. It is not in the library;
/// `hardcover_url` links to it on Hardcover.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BookSuggestion {
    pub hardcover_id: i64,
    /// The book's page on Hardcover.
    pub hardcover_url: String,
    pub title: String,
    pub author: String,
    /// How many curated Hardcover lists hold both this book and the one it was
    /// suggested for. A higher count means a stronger match.
    pub list_count: i64,
    /// The path of the cached cover, `/api/suggestions/{uuid}/{rank}/cover`, relative to
    /// the server. Null when no cover is cached.
    pub cover_url: Option<String>,
}

/// The Hardcover-sourced fields of one cached suggestion, grouped as the input to [`BookSuggestion::new`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RawSuggestion {
    pub hardcover_id: i64,
    pub hardcover_slug: Option<String>,
    pub title: String,
    pub author: String,
    pub list_count: i64,
}

impl BookSuggestion {
    /// Build a wire suggestion from a book's cached primitives, deriving the
    /// outbound Hardcover URL (slug-based, id fallback) and the relative cover
    /// URL (only when a cover was cached).
    pub fn new(book_uuid: &str, rank: i64, raw: RawSuggestion, has_cover: bool) -> Self {
        let RawSuggestion {
            hardcover_id,
            hardcover_slug,
            title,
            author,
            list_count,
        } = raw;
        let hardcover_url = match hardcover_slug {
            Some(slug) if !slug.is_empty() => format!("{HARDCOVER_BOOK_BASE}{slug}"),
            _ => format!("{HARDCOVER_BOOK_BASE}{hardcover_id}"),
        };
        let cover_url = has_cover.then(|| format!("/api/suggestions/{book_uuid}/{rank}/cover"));
        Self {
            hardcover_id,
            hardcover_url,
            title,
            author,
            list_count,
            cover_url,
        }
    }
}

/// A book's Hardcover suggestions, or why there are none yet. `status` says which case
/// it is.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SuggestionsResponse {
    /// The server has no Hardcover API key, so it can't fetch suggestions.
    NotConfigured,
    /// The server is fetching suggestions and has none cached yet. Ask again later.
    Pending,
    /// The cached suggestions. An empty `items` means Hardcover had nothing usable, and
    /// that answer is cached too.
    Ready { items: Vec<BookSuggestion> },
}

/// Whether the server has a Hardcover API key, with the key masked. It never carries the
/// key itself.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct HardcoverKeyStatus {
    pub configured: bool,
    /// A masked preview of the key, such as `hc_l…3f9a`. Null when no key is set.
    pub masked: Option<String>,
    /// Where the key in effect comes from: `settings` when saved through the API, `env`
    /// when read from the server's environment variables, or `none`.
    pub source: String,
}

/// A Hardcover API key to save, or none to clear the saved one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetHardcoverKey {
    /// The Hardcover API token, up to 2048 bytes. Null, left out or blank clears the
    /// saved key.
    #[serde(default)]
    pub key: Option<String>,
}

#[cfg(test)]
mod tests;
