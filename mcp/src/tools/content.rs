//! The book-content read tool family: list an EPUB's chapters, read one
//! chapter's plain text in bounded slices, full-text search the library's
//! indexed chapter text, and list an EPUB's images. Pure reads over existing
//! `GET` endpoints — nothing here touches the [`crate::client::WRITE_ALLOWLIST`].

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::{tool, tool_router, ErrorData, Json};
use schemars::JsonSchema;
use serde::Deserialize;

use omnibus_shared::{
    BookImageLink, BookImageList, BookImageRead, ChapterListResponse, ChapterTextResponse,
    ContentSearchResults, SpoilerFilter,
};

use crate::client::ClientError;
use crate::server::OmnibusMcp;

/// Parameters for the chapter listing.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListChaptersParams {
    /// The book's uuid (the `unique_identifier` field on book records).
    pub book_uuid: String,
}

/// Parameters for the image listing.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListBookImagesParams {
    /// The book's uuid.
    pub book_uuid: String,
}

/// Parameters for the bounded chapter-text read. The numeric fields are
/// `i64` to match the shared wire types (`ChapterListEntry::spine_index`,
/// `ChapterTextResponse::next_offset`) so a schema-driven client round-trips
/// them without signed/unsigned coercion; negatives are rejected up front.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ChapterTextParams {
    /// The book's uuid.
    pub book_uuid: String,
    /// The chapter's spine index, from list_chapters (valid indexes are
    /// `0..spine_count`).
    pub spine_index: i64,
    /// Char offset to start from — pass a previous slice's `next_offset`
    /// to continue. Defaults to 0.
    pub offset: Option<i64>,
    /// Slice size in chars; server-clamped to at most 100000.
    pub limit: Option<i64>,
    /// Stop the text at the reader's own furthest recorded position in this
    /// book. Use it whenever the reader is mid-book and the conversation
    /// must not run ahead of them.
    pub stop_at_progress: Option<bool>,
}

/// Reject a negative value before it is formatted into a URL the server's
/// unsigned parses would answer with an opaque 400.
fn non_negative(value: i64, what: &str) -> Result<i64, ErrorData> {
    if value < 0 {
        return Err(ErrorData::invalid_params(
            format!("{what} must be non-negative: got {value}"),
            None,
        ));
    }
    Ok(value)
}

/// Parameters for the image read.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadBookImageParams {
    /// The book's uuid.
    pub book_uuid: String,
    /// The image's href from list_book_images.
    pub href: String,
}

/// Longest edge of the viewable copy `read_book_image` attaches; a larger image
/// is shrunk to fit, a smaller one is never enlarged.
const PREVIEW_MAX_EDGE: u32 = 1568;

/// Decode ceilings, as in `omnibus_db::thumbs::encode_cover_preview`: a header
/// claiming a billion pixels is refused before anything is allocated for it.
const DECODE_MAX_EDGE: u32 = 8192;
const DECODE_MAX_ALLOC: u64 = 256 * 1024 * 1024;

/// JPEG quality of an opaque preview.
const PREVIEW_JPEG_QUALITY: u8 = 85;

/// A downscaled, viewable copy of `bytes` as `(bytes, media type)`: PNG when the
/// image has alpha, else JPEG. `None` unless the bytes themselves sniff as a raster
/// (never the manifest's claim) and decode within the limits, so an SVG or a
/// crafted header gets the URL only. CPU-bound: call inside `spawn_blocking`.
fn preview(bytes: &[u8]) -> Option<(Vec<u8>, &'static str)> {
    omnibus_shared::detect_image_format(bytes)?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(DECODE_MAX_EDGE);
    limits.max_image_height = Some(DECODE_MAX_EDGE);
    limits.max_alloc = Some(DECODE_MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    let fitted = if decoded.width().max(decoded.height()) > PREVIEW_MAX_EDGE {
        decoded.resize(
            PREVIEW_MAX_EDGE,
            PREVIEW_MAX_EDGE,
            image::imageops::FilterType::Triangle,
        )
    } else {
        decoded
    };
    let mut out = Vec::new();
    if fitted.color().has_alpha() {
        fitted
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .ok()?;
        return Some((out, "image/png"));
    }
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, PREVIEW_JPEG_QUALITY)
        .encode_image(&fitted.to_rgb8())
        .ok()?;
    Some((out, "image/jpeg"))
}

/// Map an image endpoint's status to the message that tells the model what to
/// do next; any other failure surfaces as the client's own error.
fn image_error(e: ClientError, uuid: &str) -> ErrorData {
    let message = match &e {
        ClientError::Status { status: 404, .. } => format!("book {uuid} not found"),
        ClientError::Status { status: 422, .. } => format!(
            "book {uuid} has no EPUB file — images are listed from EPUBs only; \
             CBZ pages and PDF pages are not covered"
        ),
        ClientError::Status { status: 400, .. } => "href is not an image in this book's EPUB \
             manifest; call list_book_images for valid hrefs"
            .to_string(),
        ClientError::Status { status: 403, .. } => {
            "this account is not permitted to download files".to_string()
        }
        _ => return ErrorData::from(e),
    };
    ErrorData::invalid_params(message, None)
}

/// Parameters for the content search.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ContentSearchParams {
    /// Words that must ALL appear in the same chapter. A natural-language
    /// phrase of several words usually matches nothing — search one
    /// distinctive term first, then narrow. Wrap in double quotes for an
    /// exact phrase; the final word is prefix-matched.
    pub query: String,
    /// Scope to one book's text. Strongly preferred when the question is
    /// about a specific book — without it a term from a series returns
    /// interleaved hits from every volume.
    pub book_uuid: Option<String>,
    /// Scope to several books (a series), as uuids.
    pub book_uuids: Option<Vec<String>>,
    /// Maximum hits to return; server-capped at 50.
    pub limit: Option<i64>,
    /// What to do about hits past the reader's own position: "annotate"
    /// (default) tags each hit with `ahead_of_reader` and
    /// `position_delta_percent`; "exclude" withholds them and reports
    /// `withheld_ahead`; "none" disables the check.
    pub spoiler_filter: Option<SpoilerFilter>,
}

#[tool_router(router = content_tools, vis = "pub(crate)")]
impl OmnibusMcp {
    #[tool(
        description = "List a book's chapters: TOC titles plus the spine_index each chapter's text is read by (via read_chapter_text), and spine_count, the number of addressable spine documents. has_text: false means the book's served format has no extractable text (audiobook-only, comic-only). For a PDF each page is one spine document: spine_index is the 0-based page and chapters are the PDF's outline (empty when it has none). A TOC-less but readable EPUB reports has_text: true with an empty chapters list — its text is still readable by spine index up to spine_count. Errors if the uuid is unknown."
    )]
    pub async fn list_chapters(
        &self,
        Parameters(p): Parameters<ListChaptersParams>,
    ) -> Result<Json<ChapterListResponse>, ErrorData> {
        let uuid = crate::tools::path_segment(&p.book_uuid, "book_uuid")?;
        let path = format!("/api/ebooks/{uuid}/chapters");
        let chapters: Option<ChapterListResponse> = self.client.get_json_opt(&path, &[]).await?;
        chapters
            .map(Json)
            .ok_or_else(|| ErrorData::invalid_params(format!("book {uuid} not found"), None))
    }

    #[tool(
        description = "Read one chapter of a book as plain text, in bounded slices (at most 100000 chars per call). Address the chapter by the spine_index from list_chapters (for a PDF, the 0-based page). When truncated is true the slice ended before the chapter did — page through by re-calling with offset set to the returned next_offset until truncated is false. has_text: false means the book has no extractable text. Errors if the uuid is unknown or spine_index is out of range.\n\nSet stop_at_progress: true when the reader is partway through the book and must not be spoiled: the text is cut at their furthest recorded position and truncated_by_progress comes back true. That cut is deliberate and final — unlike truncated, it carries no next_offset, because paging past it is the thing the flag exists to prevent. A reader whose position cannot be placed gets no text at all rather than the whole chapter."
    )]
    pub async fn read_chapter_text(
        &self,
        Parameters(p): Parameters<ChapterTextParams>,
    ) -> Result<Json<ChapterTextResponse>, ErrorData> {
        let uuid = crate::tools::path_segment(&p.book_uuid, "book_uuid")?;
        let spine_index = non_negative(p.spine_index, "spine_index")?;
        let path = format!("/api/ebooks/{uuid}/chapters/{spine_index}/text");
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(offset) = p.offset {
            query.push(("offset", non_negative(offset, "offset")?.to_string()));
        }
        if let Some(limit) = p.limit {
            query.push(("limit", non_negative(limit, "limit")?.to_string()));
        }
        if p.stop_at_progress.unwrap_or(false) {
            query.push(("stop_at_progress", "true".to_string()));
        }
        let text: Option<ChapterTextResponse> = self.client.get_json_opt(&path, &query).await?;
        text.map(Json).ok_or_else(|| {
            ErrorData::invalid_params(
                format!(
                    "book {uuid} not found, or spine_index {spine_index} is out of range \
                     (list_chapters reports the valid range as 0..spine_count)"
                ),
                None,
            )
        })
    }

    #[tool(
        description = "Full-text search over the TEXT of the library's books — distinct from search_books, which matches metadata (title, author, series, tags) only. Use this for \"find the passage where …\" questions. Each hit cites the book (book_uuid, title), the chapter it came from (spine_index and chapter_title; for a PDF the spine_index is the 0-based page and chapter_title its outline entry) and a snippet with the matched terms bracketed; follow up with read_chapter_text on the hit's book_uuid + spine_index to read the surrounding text.\n\nQUERY SYNTAX: every term must appear in the SAME chapter. A multi-word natural-language phrase therefore usually returns nothing even when each word is common — search one distinctive term, then narrow. Double quotes make an exact phrase; the last word is prefix-matched. An empty result carries a `hint` when the query form is the likely cause.\n\nPass book_uuid (or book_uuids) to scope to one book or a series — without it a term from a series returns interleaved hits from every volume. spoiler_filter places each hit against the reader's own position: \"annotate\" (the default) tags hits with ahead_of_reader and position_delta_percent, \"exclude\" withholds them and reports withheld_ahead so you can say an answer exists without seeing it. A hit whose position cannot be determined is withheld by \"exclude\" rather than assumed safe, and ahead_of_reader: null means unknown, NOT safe. Only books with extractable text are indexed, so an empty result does not prove the phrase is absent from unindexed formats."
    )]
    pub async fn search_book_content(
        &self,
        Parameters(p): Parameters<ContentSearchParams>,
    ) -> Result<Json<ContentSearchResults>, ErrorData> {
        let mut query: Vec<(&str, String)> = vec![("q", p.query)];
        if let Some(uuid) = p.book_uuid {
            query.push((
                "book_uuid",
                crate::tools::path_segment(&uuid, "book_uuid")?.to_string(),
            ));
        }
        if let Some(uuids) = p.book_uuids {
            if !uuids.is_empty() {
                query.push(("book_uuids", uuids.join(",")));
            }
        }
        if let Some(limit) = p.limit {
            query.push(("limit", non_negative(limit, "limit")?.to_string()));
        }
        if let Some(filter) = p.spoiler_filter {
            query.push((
                "spoiler_filter",
                match filter {
                    SpoilerFilter::None => "none",
                    SpoilerFilter::Annotate => "annotate",
                    SpoilerFilter::Exclude => "exclude",
                }
                .to_string(),
            ));
        }
        let hits: ContentSearchResults =
            self.client.get_json("/api/search/content", &query).await?;
        Ok(Json(hits))
    }

    #[tool(
        description = "List the images in a book's EPUB — maps, plates, illustrations, diagrams — each with its href (the image's path inside the EPUB, the handle to fetch it by), media type, byte size, pixel dimensions (absent for an SVG or a header that will not decode) and references: one per spine document that shows it, giving that document's spine_index (the same index list_chapters and read_chapter_text use) and the image's alt text when it has any. Images are ordered by where the book first shows them; ones no chapter shows come last with no references. Covers EPUB only: a book with no EPUB file (CBZ pages, PDF pages, audiobooks) errors rather than answering an empty list. Errors if the uuid is unknown."
    )]
    pub async fn list_book_images(
        &self,
        Parameters(p): Parameters<ListBookImagesParams>,
    ) -> Result<Json<BookImageList>, ErrorData> {
        let uuid = crate::tools::path_segment(&p.book_uuid, "book_uuid")?;
        let path = format!("/api/ebooks/{uuid}/images");
        let list = self
            .client
            .get_json(&path, &[])
            .await
            .map_err(|e| image_error(e, uuid))?;
        Ok(Json(list))
    }

    #[tool(
        output_schema = rmcp::handler::server::tool::schema_for_output::<BookImageRead>(),
        description = "Get one image from a book's EPUB, by the href from list_book_images. Returns the original's media_type and byte_size plus a download_url: a link on the instance's public address that fetches the full-resolution original with no further authentication and stops working at expires_at (15 minutes). Hand the URL to the user to save the file; it is the original, not a preview. The link opens that one image only. A raster image (JPEG, PNG, GIF, WebP) also comes back as an image block — a downscaled viewable copy, at most 1568 px on a side — so you can look at it; an SVG, or an image that will not decode, comes as the URL only. Errors if the uuid is unknown, the book has no EPUB file, href is not an image in that EPUB's manifest, or the account is not permitted to download files."
    )]
    pub async fn read_book_image(
        &self,
        Parameters(p): Parameters<ReadBookImageParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let uuid = crate::tools::path_segment(&p.book_uuid, "book_uuid")?;
        let query = [("href", p.href.clone())];
        // Fetching the original proves the href is a manifest image and gives its
        // true size and type before a link is minted for it.
        let (media_type, bytes) = self
            .client
            .get_bytes(&format!("/api/ebooks/{uuid}/images/file"), &query)
            .await
            .map_err(|e| image_error(e, uuid))?;
        let link: BookImageLink = self
            .client
            .get_json(&format!("/api/ebooks/{uuid}/images/link"), &query)
            .await
            .map_err(|e| image_error(e, uuid))?;
        let read = BookImageRead {
            book_uuid: p.book_uuid.clone(),
            href: p.href,
            media_type,
            byte_size: bytes.len() as i64,
            download_url: format!("{}{}", self.client.public_url(), link.path),
            expires_at: link.expires_at,
            expires_at_iso: omnibus_shared::to_iso8601(link.expires_at),
        };
        let json = serde_json::to_value(&read)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let mut result = CallToolResult::structured(json);
        // A failed or panicked decode costs the preview, not the download URL.
        let shown = tokio::task::spawn_blocking(move || preview(&bytes))
            .await
            .ok()
            .flatten();
        if let Some((data, mime)) = shown {
            result
                .content
                .push(ContentBlock::image(STANDARD.encode(data), mime));
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests;
