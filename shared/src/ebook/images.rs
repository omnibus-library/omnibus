//! Wire types for an EPUB's image listing: each manifest image with the spine
//! documents that show it, so a caller can find "the map in chapter 1" by
//! spine index (the key `list_chapters` and the chapter-text read share).

use serde::{Deserialize, Serialize};

/// One spine document that shows an image.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageReference {
    /// The document's spine index, as in `GET /api/ebooks/{uuid}/chapters`.
    pub spine_index: i64,
    /// The image's alt text where the document first shows it. Null when there is none,
    /// and always for an SVG image.
    pub alt: Option<String>,
}

/// One image in an EPUB's manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImage {
    /// The image's path inside the EPUB. `GET /api/ebooks/{uuid}/images/file` and
    /// `GET /api/ebooks/{uuid}/images/link` take it as `href`.
    pub href: String,
    /// The media type the manifest declares, such as `image/png`.
    pub media_type: String,
    /// The image's uncompressed size in bytes.
    pub byte_size: i64,
    /// The width in pixels. Null when the image header can't be read, which includes
    /// every SVG.
    pub width: Option<i64>,
    pub height: Option<i64>,
    /// Each spine document that shows the image, in spine order. Empty when none does.
    pub references: Vec<BookImageReference>,
}

/// Every image the manifest of a book's EPUB lists, from `GET /api/ebooks/{uuid}/images`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageList {
    pub book_uuid: String,
    pub images: Vec<BookImage>,
}

/// A link that fetches one image's original bytes without signing in. `path` is a
/// server-relative `GET /api/ebooks/{uuid}/images/signed` path that opens that one image
/// only. It works until `expires_at`, in Unix seconds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageLink {
    pub path: String,
    pub expires_at: i64,
}

/// One image's details and a `download_url` that fetches its original bytes without
/// signing in, until `expires_at`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookImageRead {
    pub book_uuid: String,
    pub href: String,
    pub media_type: String,
    pub byte_size: i64,
    /// An absolute URL on the server's public address.
    pub download_url: String,
    /// When the URL stops working, in Unix seconds.
    pub expires_at: i64,
    pub expires_at_iso: String,
}

/// Query parameter of `GET /api/ebooks/{uuid}/images/link` and
/// `GET /api/ebooks/{uuid}/images/file`.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct ImageHrefQuery {
    /// The image's path inside the EPUB, as `href` in `GET /api/ebooks/{uuid}/images`.
    pub href: String,
}

/// Query parameters of `GET /api/ebooks/{uuid}/images/signed`. They come in the `path` that
/// `GET /api/ebooks/{uuid}/images/link` returns. Use that path as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct SignedImageQuery {
    /// The image's path inside the EPUB.
    pub href: String,
    /// When the link stops working, in Unix seconds.
    pub expires: Option<String>,
    /// The link's signature.
    pub sig: Option<String>,
}
