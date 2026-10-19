//! Wire shape for a single ebook row.
//!
//! `EbookMetadata` is the row returned by `/api/ebooks`, `rpc_get_ebooks`,
//! and downstream detail / discovery views. `Contributor` and `Identifier`
//! are its two non-scalar sub-types.

use serde::{Deserialize, Serialize};

/// A person credited on a book, such as an author, an illustrator or a translator.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct Contributor {
    pub name: String,
    /// The person's role as a MARC relator code, such as `aut` for an author or `trl`
    /// for a translator. Null when the book doesn't say.
    pub role: Option<String>,
    /// The name to sort by, such as `Herbert, Frank`. Null when the book doesn't say.
    pub file_as: Option<String>,
    /// The author's id, as in `GET /api/authors/{id}`. Absent when no author in the
    /// library has this name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
}

/// An identifier the book's file declares, such as an ISBN:
/// `{"scheme": "ISBN", "value": "9780441013593"}`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct Identifier {
    pub value: String,
    pub scheme: Option<String>,
}

/// A book in the library, with any metadata edits applied.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct EbookMetadata {
    pub id: i64,
    pub filename: String,

    // Dublin Core core.
    pub title: Option<String>,
    // Also null on the web landing page's rows and their stack members.
    /// The book's description as sanitized HTML. Null in a `GET /api/ebooks` page
    /// requested with `omit_description=true`, and in its stacks. There, null does not
    /// mean empty. Read the book from `GET /api/ebooks/{uuid}` for it.
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub modified: Option<String>,
    pub language: Option<String>,

    /// The people credited on the book, with the file's creators first and its other
    /// contributors after them.
    pub creators: Vec<Contributor>,
    pub subjects: Vec<String>,
    pub identifiers: Vec<Identifier>,

    /// Genres users have given the book. Book files carry no genre, so this list holds
    /// only what users set.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,

    /// The book's ISBN-13. It is an edit's value, or else the first of `identifiers`
    /// whose scheme names ISBN and whose value reads as 13 digits. Absent when there is
    /// none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn13: Option<String>,

    /// The book's ISBN-10. Only an edit sets it, since book files don't carry a separate
    /// ISBN-10.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn10: Option<String>,

    // Series / collection (Calibre + EPUB3 belongs-to-collection).
    pub series: Option<String>,
    pub series_index: Option<String>,
    /// The series' id, as in `GET /api/series/{id}`. Absent when the book is in no
    /// series.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series_id: Option<i64>,

    /// The book's uuid, which the `{uuid}` routes take, such as
    /// `GET /api/ebooks/{uuid}`.
    pub unique_identifier: Option<String>,

    /// The cover's path on this server, `/api/covers/{uuid}`, to join with the server's
    /// base URL. Null when the book has no cover.
    pub cover_url: Option<String>,

    /// A color picked from the cover, as a CSS color in the form `oklch(L C H)`. Absent
    /// when the book has no cover or no color could be picked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub formats: Vec<String>,

    /// Whether at least one physical copy of the book is checked in. Absent when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_physical: bool,

    /// When the book was added to the library, as an ISO 8601 UTC timestamp such as
    /// `2024-05-01T12:00:00Z`. The `newest_added` sort orders by it.
    #[serde(default)]
    pub added_at: Option<String>,

    /// The last time anyone rated the book, published a journal entry on it, changed its
    /// read status, added it, edited its metadata or cover, or checked in a physical
    /// copy. It is an ISO 8601 UTC timestamp such as `2024-05-01T12:00:00Z`, so it sorts
    /// as text. The `recently_interacted` sort orders by it. Absent only for a book with
    /// none of these events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_interacted_at: Option<String>,

    pub error: Option<String>,

    /// Whether the book has metadata edits. `DELETE /api/ebooks/{uuid}/overrides`
    /// removes them.
    #[serde(default)]
    pub has_override: bool,

    /// Whether `cover_url` serves an uploaded cover rather than the one from the book's
    /// file.
    #[serde(default)]
    pub has_cover_override: bool,

    /// Every file of the book on disk, including the only file of a single-file book.
    /// Count files per format from this list. Each file's `etag` tells whether a
    /// downloaded copy is stale. Absent in list responses such as `GET /api/ebooks`, and
    /// for a book with no file.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub book_files: Vec<BookFileInfo>,

    /// The size in bytes of the file Send to Kindle emails, which is the book's first
    /// EPUB or else its PDF. Omnibus won't email a file over 50,000,000 bytes. Absent when the
    /// book has neither, and in list responses such as `GET /api/ebooks`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epub_size_bytes: Option<i64>,

    /// The number of pages in the book's CBZ comic, as
    /// `GET /api/ebooks/{uuid}/pages/{page}` serves them. Absent for a book with no CBZ,
    /// an archive that can't be read, or a file Omnibus hasn't counted yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<i64>,

    /// The page count of a print edition, as a user entered it. It is not `page_count`,
    /// which counts the images in a CBZ comic, and both can be set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub print_pages: Option<i64>,
}

impl EbookMetadata {
    /// The book's own title, or its filename when the title is unset.
    pub fn display_title(&self) -> String {
        self.title.clone().unwrap_or_else(|| self.filename.clone())
    }
}

/// One of a book's files on disk. A book can have several, such as two EPUB editions.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookFileInfo {
    pub id: i64,
    pub format: String,
    pub filename: String,
    pub ordinal: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// The file's size in bytes.
    #[serde(default)]
    pub size_bytes: i64,
    /// The file's path inside the library folder, such as `clarke/piranesi.epub`. Absent
    /// for a few files indexed by old versions of Omnibus.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    // Derived by `crate::file_etag`.
    /// The file's content validator. Save it with a download and compare it with a later
    /// value. A different value means the downloaded copy is stale. Absent until the
    /// server has read the file's size and modification time. A missing value on either
    /// side means you can't tell, not that the copy is current.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    // Whole seconds, unlike the fractional `ProgressRecord::total_duration_seconds`:
    // a catalog row is read for "how long is it", not for position arithmetic.
    /// The file's playing time in whole seconds, summed over its parts. Present for audio
    /// files only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<i64>,
}

/// Query parameters of `GET /api/ebooks/{uuid}/file` and `GET /api/ebooks/{uuid}/download`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct EbookFileQuery {
    /// One of the book's EPUB or PDF files, by its `id` in the book's `book_files`. Leave it
    /// out for the file the route picks by default.
    pub file_id: Option<i64>,
}
