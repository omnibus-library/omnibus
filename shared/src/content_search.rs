//! Wire types for the book-content full-text search (`GET
//! /api/search/content`). Produced by the server's content-search handler
//! from `book_content_fts` hits; distinct from the metadata search's
//! `EbookLibrary` shape because a content hit cites a chapter, not a book row.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// What to do with search hits past your reading position. The default, `annotate`,
/// marks them, so a caller can say an answer exists but lies ahead. `exclude` is for a
/// caller that must not see them at all.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SpoilerFilter {
    /// Return every hit unmarked.
    None,
    /// Return every hit, each marked with whether it is ahead of you.
    #[default]
    Annotate,
    /// Leave out hits past your position and count them in `withheld_ahead`, so the
    /// caller knows an answer exists without seeing it.
    Exclude,
}

/// Query parameters of `GET /api/search/content`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct ContentSearchQuery {
    /// Words to find in the text, up to 1,024 bytes. A chapter matches when it holds every
    /// word.
    pub q: String,
    /// Search only this book, by uuid.
    pub book_uuid: Option<String>,
    /// Search only these books, given as up to 50 comma-separated uuids, such as the books
    /// of a series. Combines with `book_uuid`.
    pub book_uuids: Option<String>,
    /// The most hits to return, from 1 to 50. Defaults to 50.
    pub limit: Option<i64>,
    /// What to do with hits past your own reading position. Defaults to `annotate`.
    #[serde(default)]
    pub spoiler_filter: SpoilerFilter,
}

/// One chapter that matches a content search, with an excerpt around the match.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ContentSearchHit {
    /// The book's uuid.
    pub book_uuid: String,
    /// The spine index of the chapter the match is in, counted from 0.
    pub spine_index: i64,
    /// The book's title, or its path in the library folder when it has none.
    pub title: String,
    /// The chapter's title from the book's table of contents. Absent when Omnibus
    /// hasn't read the book's table of contents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_title: Option<String>,
    /// An excerpt around the match. Each matched word is wrapped in `[` and `]`, and
    /// cut text is marked with `…`.
    pub snippet: String,
    /// Whether the hit is past your furthest recorded position in the book. Absent
    /// under `spoiler_filter=none`, when you have no position in the book, or when the
    /// hit can't be placed in it. Absent does not mean the hit is safe to show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ahead_of_reader: Option<bool>,
    /// How far the hit is from your position, in whole-book percentage points. A
    /// positive value is ahead of you and a negative one behind. Absent whenever
    /// `ahead_of_reader` is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_delta_percent: Option<f64>,
}

/// The chapters `GET /api/search/content` found, best match first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ContentSearchResults {
    pub hits: Vec<ContentSearchHit>,
    /// How many hits past your position `spoiler_filter=exclude` left out. Always
    /// present under `exclude`, as 0 when it left none out. Absent under the other
    /// modes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub withheld_ahead: Option<i64>,
    /// Why the result is empty, when the query's wording is the likely cause. A chapter
    /// must hold every word of the query, so a question written as a sentence often
    /// matches nothing while its words alone match plenty. Absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}
