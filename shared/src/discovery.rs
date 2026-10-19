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

/// Response payload for `GET /api/ebooks` and `rpc_get_ebooks`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct EbookLibrary {
    pub path: Option<String>,
    pub books: Vec<EbookMetadata>,
    pub error: Option<String>,
    /// Total FTS5 hit count *before* the server-side `MAX_BOOKS_RETURNED` cap,
    /// set by the search paths so the web client can show "N of M results"
    /// even when `books` is truncated. `None` for the full-library
    /// (`/api/ebooks`, `rpc_get_ebooks`) responses, which surface truncation
    /// via the `X-Total-Count` header instead.
    #[serde(default)]
    pub total: Option<i64>,
}

/// One response of `GET /api/ebooks`: a page of books, plus the series it folded into
/// stacks when the request set `stack_series`.
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
    /// Where the page starts: the previous page's `X-Next-Cursor`. Needs `sort` and `dir`,
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
    /// Comma-separated formats to leave out, such as `cbz`: the formats the user hides
    /// from their library view.
    pub exclude_formats: Option<String>,
    /// Fold each series of two or more books into one row and list the series in `stacks`.
    /// `X-Total-Count` still counts books. Applies to a paged request only.
    pub stack_series: Option<bool>,
    /// Leave each book's description out, for a lighter page. Applies to a paged request only.
    pub omit_description: Option<bool>,
}

/// One facet value paired with the number of books carrying it. `value` is the
/// canonical key the filter chips toggle (author/series/tag name, or a
/// lowercased format key like `"epub"`); `count` is the book tally across the
/// whole (unfiltered) library.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FacetCount {
    pub value: String,
    pub count: i64,
}

/// Per-facet book counts, the type of `LibraryPage.facets`; no server path
/// populates it. Each list is ordered by count descending, then value
/// ascending. Formats are keyed by their lowercased extension (`"epub"`,
/// `"m4b"`).
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

/// Response payload for the keyset-paginated **web** landing read
/// (`rpc_get_ebooks_page`): one page of books plus the opaque `next_cursor`
/// (`None` at end of stream) the client hands back verbatim. `total` is populated
/// only on the first, cursor-less page. The mobile REST `GET /api/ebooks` keeps
/// the `EbookLibrary` body and an `X-Next-Cursor` header instead.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LibraryPage {
    pub path: Option<String>,
    pub books: Vec<EbookMetadata>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub total: Option<i64>,
    /// Always `None`; kept so the wire shape stays compatible.
    #[serde(default)]
    pub facets: Option<FacetCounts>,
    /// How many books the caller's `exclude_formats` hid — the landing
    /// receipt. `Some` only on the first page of a request that sent a
    /// non-empty exclusion; both counts behind it share the same filters and
    /// differ only in the exclusion.
    #[serde(default)]
    pub hidden_count: Option<i64>,
    /// The series folded into a row of `books`; present only when stacked.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stacks: Vec<SeriesStack>,
}

/// Author detail payload for `GET /api/authors/:id` and `rpc_get_author`.
/// Contains the author row plus every book by that author.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct AuthorDetail {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    pub books: Vec<EbookMetadata>,
    /// `true` when a usable profile photo is cached for this author
    /// (a `manual` or `openlibrary` row in `author_photos`). The frontend
    /// hero swaps the letter avatar for `<img src="/api/authors/:id/photo">`
    /// when set. `'letter'` negative-cache rows do not set this flag.
    #[serde(default)]
    pub has_photo: bool,
    /// The caller's state on each of `books` they have opened or marked;
    /// a book absent here is unread with no position.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reading: Vec<BookReading>,
}

/// One reader's state on one book: its status, how far in, and when.
/// `status` is the stored one; a book with a position but no stored status
/// reads as `Reading`, as it does on the Continue rail.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookReading {
    pub book_uuid: String,
    pub status: ReadStatus,
    /// Whole-book percent of the latest position, floored; `None` without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<i64>,
    /// The latest position's format and audio file, so a Resume opens the
    /// reader or player (and file) it was left in. `None` without a position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ProgressFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_file_id: Option<i64>,
    /// Unix seconds of the latest position (client time), else of the status
    /// change; `None` for a book marked `Unread`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_read_at: Option<i64>,
}

/// One reader's progress through one author's books, for the `/authors`
/// list. Per-reader, so it rides its own request beside [`AuthorSummary`],
/// which every reader shares. An author the reader never opened is absent.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct AuthorReading {
    pub author_id: i64,
    pub finished: usize,
    pub reading: usize,
    /// The newest [`BookReading::last_read_at`] across the author's books.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_read_at: Option<i64>,
}

/// Result of an admin-triggered "Scan for picture" run. The endpoint
/// clears any cached row and runs the Open Library cascade inline; a
/// `false` here means Open Library had nothing to offer for this author
/// and a sticky `letter` marker has been written to skip future
/// autoresolution.
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
    /// The photo: a JPEG, PNG, GIF or WebP image of 10 MiB or less, sent with an
    /// `image/*` content type. SVG is refused.
    #[cfg_attr(feature = "openapi", schema(value_type = String, format = Binary))]
    pub photo: Vec<u8>,
}

/// Series detail payload for `GET /api/series/:id` and `rpc_get_series`.
/// Books are ordered by `series_index`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SeriesDetail {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    pub books: Vec<EbookMetadata>,
}

/// Most rows the tag cloud returns; a longer vocabulary is cut to its most-used tags.
pub const TAG_CLOUD_LIMIT: usize = 500;

/// Most rows the genre cloud returns, cut to the most-used the same way.
pub const GENRE_CLOUD_LIMIT: usize = 500;

/// Single tag with its book count, for the tag cloud.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct TagWeight {
    pub name: String,
    pub count: usize,
}

/// One genre with the number of books carrying it. Structurally a
/// [`TagWeight`], kept a distinct type so `/api/genres` and `/api/tags`
/// don't share a wire name for two different vocabularies.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct GenreWeight {
    pub name: String,
    pub count: usize,
}

/// Lightweight author row for the `/authors` index. Carries only what the
/// card needs — no joined book list. The detail page (`AuthorDetail`) is
/// fetched on click.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct AuthorSummary {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    /// Cover-derived accent color borrowed from the author's first book
    /// with a non-null `accent_color`. `None` when no owned book has one
    /// — the UI falls back to the theme accent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    /// `true` when a usable profile photo is cached for this author (a
    /// `manual` or `openlibrary` row in `author_photos`). Same semantics
    /// as `AuthorDetail::has_photo` — `'letter'` negative-cache rows do
    /// not set this flag. Lets the `/authors` index render a real `<img>`
    /// in one round trip instead of fetching the detail payload per card.
    #[serde(default)]
    pub has_photo: bool,
}

/// Lightweight series row for the `/series` index. Carries the primary
/// author of the series (first book's first creator) so the card can
/// render the by-line without a second fetch.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct SeriesSummary {
    pub id: i64,
    pub name: String,
    pub sort: Option<String>,
    pub book_count: usize,
    /// Primary author display string (first book's first creator). `None`
    /// when the series has no books with a linked author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_author: Option<String>,
    /// Accent color borrowed from the first book in the series with one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
}

/// Search-palette response — grouped results with server-side timing.
///
/// Each category is capped at 5 hits server-side. The slim per-hit types
/// (`PaletteBookHit` etc.) carry only display data — no N+1 joins for
/// description / identifiers / subjects.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteResults {
    pub query: String,
    pub books: Vec<PaletteBookHit>,
    pub authors: Vec<PaletteAuthorHit>,
    pub series: Vec<PaletteSeriesHit>,
    pub tags: Vec<PaletteTagHit>,
    /// `#[serde(default)]` for the same reason as the totals below, and one
    /// that bites harder: the native iOS client decodes this payload and
    /// predates the field.
    #[serde(default)]
    pub genres: Vec<PaletteGenreHit>,
    pub duration_ms: u64,
    /// True match counts per category, before the 5-hit display cap.
    // `#[serde(default)]` keeps older/partial payloads (and the command
    // palette, which ignores these) deserializing.
    #[serde(default)]
    pub book_total: u32,
    #[serde(default)]
    pub author_total: u32,
    #[serde(default)]
    pub series_total: u32,
    #[serde(default)]
    pub tag_total: u32,
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

/// Slim book hit for the search palette. No description, no identifiers,
/// no subjects — just what the result row needs to render.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteBookHit {
    pub id: i64,
    /// Stable UUID — what the frontend should use to construct
    /// `/books/:uuid` and `/api/covers/:uuid` URLs.
    #[serde(default)]
    pub uuid: String,
    pub title: String,
    /// Pre-joined author names (e.g. "Grace Hopper, Margaret Hamilton").
    pub author_display: String,
    /// Four-digit year extracted from `pubdate`, if present.
    pub year: Option<String>,
    pub formats: Vec<String>,
    pub cover_url: Option<String>,
    pub accent: Option<String>,
    /// Whether a physical copy is checked in. `formats` says only whether a
    /// file exists, and a paper-only book has none — the check-in picker
    /// needs both to word its confirm. Defaulted so an older payload decodes.
    #[serde(default)]
    pub has_physical: bool,
}

/// Author hit for the search palette.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteAuthorHit {
    pub id: i64,
    pub name: String,
    /// Number of books by this author in the active library.
    pub book_count: u32,
    /// Title of this author's first book in the library (by sort order),
    /// used for the "incl. <title>" line on the results page. `None` when
    /// the author has no resolvable book title.
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
    /// Primary author of the first book in the series, if any.
    pub author_display: Option<String>,
    /// Title of the first book in the series (by sort order), used for the
    /// "incl. <title>" line on the results page. `None` when the series has
    /// no resolvable book title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_book_title: Option<String>,
}

/// Tag hit for the search palette.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteTagHit {
    pub id: i64,
    pub name: String,
    /// Number of books with this tag in the active library.
    pub book_count: u32,
}

/// Genre hit for the search palette. Carries no `id` — unlike a tag, a genre
/// has no navigable row to link to: migration `0066` gives the vocabulary a
/// `genres` table but no memberships, so the only thing to do with one is
/// refine the query to `genre:<name>`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PaletteGenreHit {
    /// The canonical spelling `materialize_genre_rows` coined, so a library
    /// holding both "sci-fi" and "Sci-Fi" reports one row (matching
    /// `get_genre_cloud`).
    pub name: String,
    /// Number of books carrying this genre in the active library.
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
