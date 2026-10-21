//! Discovery, browse, and search-palette wire types: the author / series / tag
//! detail pages, the author and series browse indexes, the library landing
//! payload, and the command-palette grouped result shape. Each card-level type
//! stays slim so list endpoints avoid the N+1 cost of returning a full
//! `EbookMetadata`.

use serde::{Deserialize, Serialize};

use crate::ebook::EbookMetadata;
use crate::progress::ProgressFormat;
use crate::read_status::ReadStatus;
use crate::series_stacks::SeriesStack;
use crate::view_prefs::{SortDir, SortKey};

/// A list of books, either the whole library from `GET /api/ebooks` or the matches from
/// `GET /api/search`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct EbookLibrary {
    pub path: Option<String>,
    pub books: Vec<EbookMetadata>,
    pub error: Option<String>,
    // Only the web search server function sets this; the REST routes carry the
    // count in headers.
    /// How many books matched before the list was cut to 50,000. Always null from the
    /// `/api/*` routes, which send that count in the `X-Total-Count` header.
    #[serde(default)]
    pub total: Option<i64>,
}

/// One response of `GET /api/ebooks`, holding a page of books and the series it folded
/// into stacks when the request set `stack_series`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct EbookPage {
    #[serde(flatten)]
    pub library: EbookLibrary,
    /// The series folded into one row each. Absent unless the request set `stack_series`
    /// and the page held a series of two or more books.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stacks: Vec<SeriesStack>,
}

/// Query parameters of `GET /api/ebooks`. With none of `sort`, `dir`, `cursor`, `limit`,
/// `formats`, `filter` or `exclude_formats`, the response is the whole library at once;
/// any of them makes it one page of a listing that `cursor` walks through.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct EbooksQuery {
    /// The order to list books in.
    pub sort: Option<SortKey>,
    /// Ascending or descending.
    pub dir: Option<SortDir>,
    /// Where the page starts, as the previous page's `X-Next-Cursor`. Needs `sort` and `dir`,
    /// set as they were for that page.
    pub cursor: Option<String>,
    /// Books per page. Defaults to 100.
    pub limit: Option<i64>,
    /// Comma-separated formats to include, such as `m4b,mp3`. Older clients send this;
    /// newer ones put a `format` clause in `filter`.
    pub formats: Option<String>,
    /// Filter clauses as a percent-encoded JSON array, such as
    /// `[{"field":"format","mode":"include","values":["epub"]}]`. A clause matches a book
    /// when any of its values does, and a book must match every clause. Up to 16 clauses
    /// of up to 64 values each.
    pub filter: Option<String>,
    /// Comma-separated formats to leave out, such as `cbz`. These are the formats the user
    /// hides from their library view.
    pub exclude_formats: Option<String>,
    /// Fold each series of two or more books into one row and list the series in `stacks`.
    /// `X-Total-Count` still counts books. Applies to a paged request only.
    pub stack_series: Option<bool>,
    /// Leave each book's description out, for a lighter page. Applies to a paged request only.
    pub omit_description: Option<bool>,
}

/// A facet value and how many books in the whole library carry it, with no filter
/// applied. `value` is an author, series or tag name, or a lowercase format such as
/// `epub`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FacetCount {
    pub value: String,
    pub count: i64,
}

/// Book counts for each facet value. The server never sends one. Each list runs from
/// the highest count down, then by value. Formats are lowercase extensions, such as
/// `epub` or `m4b`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FacetCounts {
    pub authors: Vec<FacetCount>,
    pub series: Vec<FacetCount>,
    pub formats: Vec<FacetCount>,
    pub tags: Vec<FacetCount>,
    #[serde(default)]
    pub genres: Vec<FacetCount>,
}

// The web landing page's server function returns this.
/// One page of the library and the cursor to the next. `GET /api/ebooks` sends a page as
/// an `EbookPage` instead, with the cursor and counts in headers.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LibraryPage {
    pub path: Option<String>,
    pub books: Vec<EbookMetadata>,
    /// The cursor for the next page, to send back as it is. Null on the last page.
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// How many books pass the request's filter and format exclusion. Set on the first
    /// page only.
    #[serde(default)]
    pub total: Option<i64>,
    /// Always null.
    #[serde(default)]
    pub facets: Option<FacetCounts>,
    /// How many books the request's `exclude_formats` hid. Set only on the first page of
    /// a request that excludes a format.
    #[serde(default)]
    pub hidden_count: Option<i64>,
    /// The series folded into one row of `books` each. Absent unless the page is stacked.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stacks: Vec<SeriesStack>,
}

/// An author and every book by them, from `GET /api/authors/{id}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct AuthorDetail {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    pub books: Vec<EbookMetadata>,
    /// Whether the server holds a photo of the author, uploaded or found on Open
    /// Library. When true, `GET /api/authors/{id}/photo` serves it.
    #[serde(default)]
    pub has_photo: bool,
    /// Your state on each of `books` that you have opened or marked. A book missing
    /// here is unread, with no position.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reading: Vec<BookReading>,
}

/// Your state on one book: its status, how far in you are, and when you last read it.
/// A book with a position but no status set reads as `reading`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookReading {
    pub book_uuid: String,
    pub status: ReadStatus,
    /// Your latest position as a whole-book percent, rounded down. Absent without a
    /// position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<i64>,
    /// The format of your latest position, so a client resumes in the same reader or
    /// player. Absent without a position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ProgressFormat>,
    /// The audio file of your latest position, by its `id` in the book's `book_files`.
    /// Absent without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_file_id: Option<i64>,
    /// When you last read the book, in Unix seconds. It is the time your device gave the
    /// latest position, or else the time the status changed. Absent for a book marked
    /// `unread`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_read_at: Option<i64>,
}

// Per-reader, so it rides its own request beside `AuthorSummary`, which every
// reader shares.
/// Your progress through one author's books, from `GET /api/authors/reading`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct AuthorReading {
    pub author_id: i64,
    pub finished: usize,
    pub reading: usize,
    /// The latest `last_read_at` of your `BookReading` across the author's books, in
    /// Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_read_at: Option<i64>,
}

/// The result of `POST /api/authors/{id}/photo/scan`. `resolved` is false when Open
/// Library has no photo of the author. Omnibus then stops searching for one by itself.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AuthorPhotoScanResult {
    pub resolved: bool,
}

/// Body of `PUT /api/authors/{id}/photo/url`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AuthorPhotoUrlBody {
    /// An `http` or `https` URL of a JPEG, PNG, GIF or WebP image, up to 2048 bytes.
    pub url: String,
}

/// Describes the multipart form `PUT /api/authors/{id}/photo` takes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AuthorPhotoUpload {
    /// The photo, as a JPEG, PNG, GIF or WebP image of 10 MiB or less, sent with an
    /// `image/*` content type. SVG is refused.
    #[cfg_attr(feature = "openapi", schema(value_type = String, format = Binary))]
    pub photo: Vec<u8>,
}

/// A series and its books, ordered by `series_index`, from `GET /api/series/{id}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SeriesDetail {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    pub books: Vec<EbookMetadata>,
    /// Your state on each of `books` that you have opened or marked. A book missing
    /// here is unread, with no position.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reading: Vec<BookReading>,
}

// Per-reader, so it rides its own request beside `SeriesSummary`, which every
// reader shares.
/// Your progress through one series, from `GET /api/series/reading`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SeriesReading {
    pub series_id: i64,
    pub finished: usize,
    pub reading: usize,
    /// The latest `last_read_at` of your `BookReading` across the series' books, in
    /// Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_read_at: Option<i64>,
}

/// Most rows the tag cloud returns; a longer vocabulary is cut to its most-used tags.
pub const TAG_CLOUD_LIMIT: usize = 500;

/// Most rows the genre cloud returns, cut to the most-used the same way.
pub const GENRE_CLOUD_LIMIT: usize = 500;

/// A tag and the number of books that carry it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct TagWeight {
    pub name: String,
    pub count: usize,
}

// Structurally a `TagWeight`, kept a distinct type so `/api/genres` and
// `/api/tags` don't share a wire name for two different vocabularies.
/// A genre and the number of books that carry it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct GenreWeight {
    pub name: String,
    pub count: usize,
}

/// One author in `GET /api/authors`, without their books. `GET /api/authors/{id}`
/// has the books.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct AuthorSummary {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    /// The `accent` of the author's first book that has one. Absent when none does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    /// Whether the server holds a photo of the author, as `has_photo` in
    /// `AuthorDetail`.
    #[serde(default)]
    pub has_photo: bool,
}

/// One series in `GET /api/series`, with its main author.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SeriesSummary {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    /// The first creator of the series' first book. Absent when no book in the series
    /// has a linked author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_author: Option<String>,
    /// The `accent` of the series' first book that has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
}

/// The matches `GET /api/search/palette` found, grouped by kind. Each list holds up to
/// 5 hits, or up to the request's `limit`. A hit carries only what a result row shows.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteResults {
    pub query: String,
    pub books: Vec<PaletteBookHit>,
    pub authors: Vec<PaletteAuthorHit>,
    pub series: Vec<PaletteSeriesHit>,
    pub tags: Vec<PaletteTagHit>,
    // `#[serde(default)]` for the same reason as the totals below, and one
    // that bites harder: the native iOS client decodes this payload and
    // predates the field.
    #[serde(default)]
    pub genres: Vec<PaletteGenreHit>,
    /// How long the search took on the server, in milliseconds.
    pub duration_ms: u64,
    // `#[serde(default)]` keeps older/partial payloads (and the command
    // palette, which ignores these) deserializing.
    /// How many books match in all, before the list was cut.
    #[serde(default)]
    pub book_total: u32,
    /// How many authors match in all.
    #[serde(default)]
    pub author_total: u32,
    /// How many series match in all.
    #[serde(default)]
    pub series_total: u32,
    /// How many tags match in all.
    #[serde(default)]
    pub tag_total: u32,
    /// How many genres match in all.
    #[serde(default)]
    pub genre_total: u32,
}

/// Query parameter of `GET /api/search`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct SearchQuery {
    /// Words to match against titles, authors and series, up to 1,024 bytes. Prefix a word
    /// with `author:` or `series:` to match only that field, or with `tag:` or `genre:` to
    /// keep only books with that tag or genre, such as `author:herbert dune`.
    pub q: String,
}

/// Query parameters of `GET /api/search/palette`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct PaletteQuery {
    /// What to search for, up to 1,024 bytes.
    pub q: String,
    /// The most hits per category, from 1 to 500. Defaults to 5.
    pub limit: Option<u32>,
}

impl PaletteResults {
    /// Total number of matches across every result category, using the true
    /// per-category totals (not the capped `Vec` lengths).
    pub fn total_count(&self) -> usize {
        (self.book_total
            + self.author_total
            + self.series_total
            + self.tag_total
            + self.genre_total) as usize
    }
}

/// A book that matches a palette search, with only what a result row shows.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteBookHit {
    pub id: i64,
    /// The book's uuid, for routes such as `GET /api/ebooks/{uuid}`.
    #[serde(default)]
    pub uuid: String,
    pub title: String,
    /// The authors' names joined into one string, such as
    /// `Grace Hopper, Margaret Hamilton`.
    pub author_display: String,
    /// The four-digit year the book was published. Null when unknown.
    pub year: Option<String>,
    pub formats: Vec<String>,
    pub cover_url: Option<String>,
    pub accent: Option<String>,
    /// Whether a physical copy is checked in. A book with only a paper copy has an
    /// empty `formats`.
    #[serde(default)]
    pub has_physical: bool,
}

/// Author hit for the search palette.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteAuthorHit {
    pub id: i64,
    pub name: String,
    /// How many books by the author the library holds.
    pub book_count: u32,
    /// The title of the author's first book in sort order. Absent when none of the
    /// author's books has a title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_book_title: Option<String>,
}

/// Series hit for the search palette.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteSeriesHit {
    pub id: i64,
    pub name: String,
    pub book_count: u32,
    /// The first author of the series' first book. Null when it has none.
    pub author_display: Option<String>,
    /// The title of the series' first book in sort order. Absent when none of the
    /// series' books has a title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_book_title: Option<String>,
}

/// Tag hit for the search palette.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteTagHit {
    pub id: i64,
    pub name: String,
    /// How many books carry the tag.
    pub book_count: u32,
}

/// A genre that matches a palette search. A genre has no page of its own, so it carries
/// no `id`. Search for `genre:<name>` to find its books.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteGenreHit {
    /// The genre's name in one spelling, so `sci-fi` and `Sci-Fi` come back as one hit.
    pub name: String,
    /// How many books carry the genre.
    pub book_count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    // A pre-0068 server's page body lacks `hidden_count`; the serde default
    // must keep it decoding.
    #[test]
    fn library_page_deserializes_payload_missing_hidden_count() {
        let v: LibraryPage = serde_json::from_str(r#"{"path":null,"books":[]}"#).unwrap();
        assert_eq!(v.hidden_count, None);
    }
}
