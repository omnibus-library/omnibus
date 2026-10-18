//! Wire types for an EPUB's image listing: each manifest image with the spine
//! documents that show it, so a caller can find "the map in chapter 1" by
//! spine index (the key `list_chapters` and the chapter-text read share).

use serde::{Deserialize, Serialize};

/// One spine document that shows an image.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageReference {
    /// Index into the spine, as in the chapter listing.
    pub spine_index: i64,
    /// The `<img alt>` text at the document's first use; `None` when absent or
    /// blank, and always for an SVG `<image>`.
    pub alt: Option<String>,
}

/// One image in an EPUB's manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImage {
    /// The image's path inside the EPUB archive: the handle the fetch takes.
    pub href: String,
    /// The manifest's declared media type, e.g. `image/png`.
    pub media_type: String,
    /// Uncompressed size in bytes, from the archive's directory.
    pub byte_size: i64,
    /// Pixel size; `None` when the header won't decode (SVG included).
    pub width: Option<i64>,
    pub height: Option<i64>,
    /// One per spine document that shows it, in spine order; empty when
    /// nothing in the spine does.
    pub references: Vec<BookImageReference>,
}

/// `GET /api/ebooks/{uuid}/images` response: every manifest image of the
/// book's EPUB.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageList {
    pub book_uuid: String,
    pub images: Vec<BookImage>,
}

/// `GET /api/ebooks/{uuid}/images/link` response: a server-relative
/// `/api/ebooks/{uuid}/images/signed` path that fetches one image's original bytes
/// without a session until `expires_at` (unix seconds). The link opens that one
/// image and nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageLink {
    pub path: String,
    pub expires_at: i64,
}

/// What `read_book_image` answers: the image's facts plus a `download_url` that
/// fetches the original bytes without a session until `expires_at`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageRead {
    pub book_uuid: String,
    pub href: String,
    pub media_type: String,
    pub byte_size: i64,
    /// Absolute URL on the instance's public origin.
    pub download_url: String,
    /// Unix seconds the URL stops working.
    pub expires_at: i64,
    pub expires_at_iso: String,
}
