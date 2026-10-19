//! Wire types for the chapter listing and plain-text chapter reads
//! (`GET /api/ebooks/{uuid}/chapters` and
//! `GET /api/ebooks/{uuid}/chapters/{spine_index}/text`).

use serde::{Deserialize, Serialize};

/// Per-request cap on served chapter text, in characters. A single spine
/// document in a reference work can run to megabytes, so the text read
/// slices at this bound and reports the boundary (`truncated` /
/// `next_offset`) rather than returning an unbounded body. Char-based so a
/// slice can never split a UTF-8 sequence.
pub const CHAPTER_TEXT_MAX_CHARS: usize = 100_000;

/// One entry of a book's table of contents, with the spine index its text is read by.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ChapterListEntry {
    /// The entry's place in the table of contents, counted from 0.
    pub ordinal: i64,
    pub title: String,
    /// The spine document the entry points to. Pass it to
    /// `GET /api/ebooks/{uuid}/chapters/{spine_index}/text`.
    pub spine_index: i64,
}

/// A book's table of contents, from `GET /api/ebooks/{uuid}/chapters`. `has_text` is
/// false when the book has no text to read, such as a comic or an audiobook. An EPUB
/// without a table of contents has `has_text` true and an empty `chapters`. Its text can
/// still be read by spine index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ChapterListResponse {
    pub book_uuid: String,
    pub has_text: bool,
    /// The number of spine documents. Text can be read at spine indexes from 0 to one
    /// less than this. 0 when `has_text` is false.
    pub spine_count: i64,
    pub chapters: Vec<ChapterListEntry>,
}

/// One slice of a spine document's text as plain prose, from
/// `GET /api/ebooks/{uuid}/chapters/{spine_index}/text`. A slice holds up to 100,000
/// characters. When `has_text` is false, the book has no text and the other fields are
/// empty or 0.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ChapterTextResponse {
    pub book_uuid: String,
    pub has_text: bool,
    pub spine_index: i64,
    pub text: String,
    /// Where the slice starts, in characters from the start of the document. It echoes
    /// the request's `offset`.
    pub offset: i64,
    /// The length of the whole document's text, in characters.
    pub total_chars: i64,
    /// Whether the document goes on past this slice.
    pub truncated: bool,
    /// The `offset` to request for the next slice. Null when the slice reaches the end.
    pub next_offset: Option<i64>,
    /// Whether the slice stops at your furthest reading position, as `stop_at_progress`
    /// asks. `truncated` is then false and `next_offset` null, since there is nothing to
    /// continue to. Absent when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated_by_progress: bool,
}

/// Query parameters of `GET /api/ebooks/{uuid}/chapters/{spine_index}/text`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct ChapterTextQuery {
    /// Where the slice starts, in characters from the start of the chapter. Defaults to 0.
    /// Pass the previous slice's `next_offset` to continue.
    pub offset: Option<usize>,
    /// The most characters to return, from 1 to 100,000. Defaults to 100,000, and a larger
    /// value is lowered to it.
    pub limit: Option<usize>,
    /// Cut the text off at your own furthest reading position in this book, so you are never
    /// handed text you haven't reached yet.
    #[serde(default)]
    pub stop_at_progress: bool,
}
