//! Wire types for the "add your own books" upload flow: the client uploads a
//! file, the server returns an [`UploadInspection`] the review form is built
//! from, then the client commits file, edits and any staged cover in one
//! request and gets back an [`UploadCommitResult`]. Shared so the REST
//! handler (`server::backend::uploads`) and the frontend data layer agree.

use serde::{Deserialize, Serialize};

use crate::ebook::{Contributor, EbookMetadata, Identifier};

/// The commit multipart's field names, beyond `file` and the legacy
/// `title`/`author`/`series`/`series_index` text fields. One owner so the
/// client and the handler cannot drift onto different names.
pub mod commit_fields {
    /// A JSON [`crate::MetadataOverrides`]: every field the reader changed on
    /// the review form, diffed against the inspection the way the edit page
    /// diffs against the loaded book.
    pub const OVERRIDES: &str = "overrides";
    /// An image the reader picked from disk during review, applied as the new
    /// book's cover override.
    pub const COVER: &str = "cover";
    /// A provider's cover URL the reader chose from the edition picker; the
    /// server fetches it under the same terms as the cover-from-URL route.
    pub const COVER_URL: &str = "cover_url";
}

/// Auto-extracted metadata returned by the inspect step. Each field mirrors
/// what the indexer would read from the file's embedded metadata, so the
/// review form starts from exactly what the library would show. The reader
/// can correct any field before committing; the corrected `title`/`author`
/// drive the on-disk folder.
///
/// The original four fields keep their place at the top level so the iOS
/// client's decoder is untouched; everything the full edit form needs is
/// `#[serde(default)]`, so an older server's reply still decodes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct UploadInspection {
    pub title: Option<String>,
    /// The first creator the file declares — what the Author field holds.
    pub author: Option<String>,
    /// Every creator the file declares, in file order, `author` first. The
    /// review form shows the rest so it never under-reports what the commit
    /// will save. Defaulted so an older server's reply still decodes.
    #[serde(default)]
    pub creators: Vec<String>,
    pub series: Option<String>,
    pub series_index: Option<String>,
    pub language: Option<String>,
    /// Whether the file carried an embedded (or sidecar) cover.
    pub has_cover: bool,
    /// Lowercased file extension the server settled on (e.g. `"epub"`).
    pub ext: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub published: Option<String>,
    /// The file's `<dc:subject>` entries — the review form's Tags.
    #[serde(default)]
    pub subjects: Vec<String>,
    /// The ISBN-13 the indexer would derive from the file's identifiers.
    #[serde(default)]
    pub isbn13: Option<String>,
    /// Every typed identifier the file declares, for the sidebar.
    #[serde(default)]
    pub identifiers: Vec<Identifier>,
    /// A small `data:` URL of the file's cover, so the review form can show it
    /// before the book exists and there is a cover route to point at. `None`
    /// when the file has no cover or it could not be decoded.
    #[serde(default)]
    pub cover_preview: Option<String>,
}

impl UploadInspection {
    /// The review form's baseline: the book as the library would index it,
    /// with `filename` set to what the reader picked so the form's read-only
    /// filename row has something honest to show. No uuid, no cover URL —
    /// neither exists yet.
    pub fn into_metadata(self, filename: &str) -> EbookMetadata {
        let creators = names_to_contributors(&self.creators);
        EbookMetadata {
            filename: filename.to_string(),
            title: self.title,
            description: self.description,
            publisher: self.publisher,
            published: self.published,
            language: self.language,
            creators,
            subjects: self.subjects,
            identifiers: self.identifiers,
            isbn13: self.isbn13,
            series: self.series,
            series_index: self.series_index,
            formats: vec![self.ext.to_ascii_uppercase()],
            // No cover route exists yet; the preview image travels separately
            // and the review form shows it in place of a fetched cover.
            cover_url: None,
            ..EbookMetadata::default()
        }
    }
}

/// Tag-derived metadata returned by the audiobook inspect step — the audiobook sibling of [`UploadInspection`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AudiobookInspection {
    pub title: Option<String>,
    pub author: Option<String>,
    /// Every creator the indexer would record from the tags, `author` first —
    /// the sibling of [`UploadInspection::creators`]. Audio containers carry
    /// one artist tag, so this holds at most that one name today; it is a
    /// list so the form reads both inspections the same way.
    #[serde(default)]
    pub creators: Vec<String>,
    /// Whether any uploaded part carried embedded cover art.
    pub has_cover: bool,
    /// Lowercased format the server settled on (`"m4b"`, `"m4a"`, `"mp3"`).
    pub format: String,
    /// Number of files in the upload (1 for a single `.m4b`/`.m4a`; N for a
    /// multi-part `.mp3` audiobook filed into one folder).
    pub part_count: usize,
    /// Combined runtime across every part, when tags supplied durations.
    pub duration_seconds: Option<f64>,
    /// A small `data:` URL of the first part's embedded art — see
    /// [`UploadInspection::cover_preview`].
    #[serde(default)]
    pub cover_preview: Option<String>,
}

impl AudiobookInspection {
    /// The review form's baseline for an audiobook — see
    /// [`UploadInspection::into_metadata`]. Tags carry no series, description
    /// or identifiers, so those start empty and the form is the only place
    /// they can be supplied.
    pub fn into_metadata(self, filename: &str) -> EbookMetadata {
        let creators = names_to_contributors(&self.creators);
        EbookMetadata {
            filename: filename.to_string(),
            title: self.title,
            creators,
            formats: vec![self.format.to_ascii_uppercase()],
            ..EbookMetadata::default()
        }
    }
}

/// Creator names as the `Contributor`s the form's author chips read, all
/// authors: the inspections carry names only, and `aut` is what the edit
/// page writes for a chip it cannot tell more about either.
fn names_to_contributors(names: &[String]) -> Vec<Contributor> {
    names
        .iter()
        .map(|name| Contributor {
            name: name.clone(),
            role: Some("aut".to_string()),
            file_as: None,
            id: None,
        })
        .collect()
}

/// Result of a successful commit: the durable uuid of the newly-filed book,
/// so the client can navigate straight to its detail page.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct UploadCommitResult {
    pub uuid: String,
}

/// Number of leading bytes [`detect_ebook_format`] needs to classify an
/// upload: the ZIP local-file-header magic is 4 bytes, a PDF's `%PDF-`
/// signature is 5.
pub const EBOOK_MAGIC_LEN: usize = 5;

/// Detect an uploadable ebook format from magic bytes. Returns the canonical
/// lowercase extension for accepted formats. Mirrors
/// [`crate::image_format::detect_image_format`] — pure byte inspection, no
/// parser dependency, so it compiles on every target.
///
/// EPUB is a ZIP archive, so it carries the ZIP local-file-header magic
/// `PK\x03\x04`; a PDF opens with `%PDF-`. A successful parse in the inspect
/// handler is the second gate; this sniff just rejects obviously-wrong
/// uploads (text, images, truncated files) before the heavier parse runs.
/// The extension decides where the file is filed and which parser reads it,
/// the way `audiobook_ext_of` lets the magic gate the family for audio.
pub fn detect_ebook_format(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < EBOOK_MAGIC_LEN {
        return None;
    }
    // ZIP local file header — every non-empty EPUB starts with this.
    if bytes.starts_with(&[0x50, 0x4B, 0x03, 0x04]) {
        Some("epub")
    } else if bytes.starts_with(b"%PDF-") {
        Some("pdf")
    } else {
        None
    }
}

/// Number of leading bytes [`detect_audiobook_format`] needs to classify an
/// upload. An MP4 `ftyp` box lives at offset 4 and its type field runs to
/// offset 8, so 8 bytes is enough; MP3 is decided from the first 3.
pub const AUDIOBOOK_MAGIC_LEN: usize = 8;

/// Detect an uploadable audiobook container family from magic bytes, returning
/// the representative lowercase family (`"mp4"` for `.m4a`/`.m4b`, `"mp3"` for
/// `.mp3`). The caller keeps the uploaded `.m4a`/`.m4b` distinction from the
/// filename — both share one ISO-BMFF container, so bytes alone can't tell them
/// apart (nor from an audio-only `.mp4`, which the upload handler files as
/// `.m4b`). Like [`detect_ebook_format`] this is a cheap first gate; a
/// successful `lofty` parse in the inspect handler is the second.
pub fn detect_audiobook_format(bytes: &[u8]) -> Option<&'static str> {
    // ISO Base Media File Format (MP4): a `ftyp` box type at offset 4. Covers
    // `.m4a` and `.m4b` regardless of the specific brand (`M4A `, `M4B `,
    // `isom`, `mp42`, …).
    if bytes.len() >= AUDIOBOOK_MAGIC_LEN && &bytes[4..8] == b"ftyp" {
        return Some("mp4");
    }
    // MP3: an ID3v2 tag header, or a raw MPEG-audio frame sync (11 set bits).
    if bytes.starts_with(b"ID3") {
        return Some("mp3");
    }
    if bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0 {
        return Some("mp3");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_ebook_format_accepts_zip_magic() {
        // `PK\x03\x04` then arbitrary trailing bytes — an EPUB's opening bytes.
        let epub = b"PK\x03\x04\x14\x00\x00\x00";
        assert_eq!(detect_ebook_format(epub), Some("epub"));
    }

    #[test]
    fn detect_ebook_format_accepts_pdf_signature() {
        assert_eq!(detect_ebook_format(b"%PDF-1.7\n"), Some("pdf"));
    }

    #[test]
    fn detect_ebook_format_rejects_other_bytes() {
        assert_eq!(detect_ebook_format(b"<html>"), None);
        assert_eq!(detect_ebook_format(b"%PDX-1.7"), None);
        // Empty-archive end-of-central-directory magic is not a real EPUB.
        assert_eq!(detect_ebook_format(b"PK\x05\x06\x00\x00"), None);
    }

    #[test]
    fn detect_ebook_format_rejects_too_short_input() {
        assert_eq!(detect_ebook_format(b"PK\x03\x04"), None);
        assert_eq!(detect_ebook_format(b"%PDF"), None);
    }

    #[test]
    fn detect_audiobook_format_accepts_mp4_ftyp_box() {
        // 4-byte box size, then `ftyp`, then a brand — an m4a/m4b opening.
        let m4b = b"\x00\x00\x00\x1cftypM4B ";
        assert_eq!(detect_audiobook_format(m4b), Some("mp4"));
    }

    #[test]
    fn detect_audiobook_format_accepts_id3_and_frame_sync_mp3() {
        assert_eq!(
            detect_audiobook_format(b"ID3\x04\x00\x00\x00\x00"),
            Some("mp3")
        );
        // MPEG-1 Layer III frame sync (0xFFFB).
        assert_eq!(
            detect_audiobook_format(&[0xFF, 0xFB, 0x90, 0x00]),
            Some("mp3")
        );
    }

    #[test]
    fn detect_audiobook_format_rejects_non_audio() {
        assert_eq!(detect_audiobook_format(b"PK\x03\x04\x14\x00\x00\x00"), None);
        assert_eq!(detect_audiobook_format(b"%PDF-1.7"), None);
        assert_eq!(detect_audiobook_format(b"ID"), None);
    }

    #[test]
    fn upload_inspection_decodes_an_older_servers_reply_without_the_review_fields() {
        let json = r#"{"title":"Dune","author":"Frank Herbert","series":null,
            "series_index":null,"language":"en","has_cover":true,"ext":"epub"}"#;
        let insp: UploadInspection = serde_json::from_str(json).unwrap();
        assert_eq!(insp.title.as_deref(), Some("Dune"));
        assert!(insp.subjects.is_empty());
        assert!(insp.cover_preview.is_none());
    }

    #[test]
    fn upload_inspection_into_metadata_carries_every_field_the_form_edits() {
        let insp = UploadInspection {
            title: Some("Dune".into()),
            author: Some("Frank Herbert".into()),
            creators: vec!["Frank Herbert".into(), "Brian Herbert".into()],
            series: Some("Dune".into()),
            series_index: Some("1".into()),
            language: Some("en".into()),
            has_cover: true,
            ext: "epub".into(),
            description: Some("Sand.".into()),
            publisher: Some("Chilton".into()),
            published: Some("1965".into()),
            subjects: vec!["scifi".into()],
            isbn13: Some("9780441013593".into()),
            identifiers: vec![Identifier {
                value: "9780441013593".into(),
                scheme: Some("ISBN".into()),
            }],
            cover_preview: Some("data:image/webp;base64,AA==".into()),
        };
        let book = insp.into_metadata("dune.epub");
        assert_eq!(book.filename, "dune.epub");
        assert_eq!(book.title.as_deref(), Some("Dune"));
        assert_eq!(book.description.as_deref(), Some("Sand."));
        assert_eq!(book.publisher.as_deref(), Some("Chilton"));
        assert_eq!(book.published.as_deref(), Some("1965"));
        assert_eq!(book.language.as_deref(), Some("en"));
        assert_eq!(book.series.as_deref(), Some("Dune"));
        assert_eq!(book.series_index.as_deref(), Some("1"));
        assert_eq!(book.isbn13.as_deref(), Some("9780441013593"));
        assert_eq!(book.subjects, vec!["scifi".to_string()]);
        assert_eq!(book.identifiers.len(), 1);
        let names: Vec<&str> = book.creators.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Frank Herbert", "Brian Herbert"]);
        assert_eq!(book.formats, vec!["EPUB".to_string()]);
        assert!(book.cover_url.is_none(), "no cover route before commit");
        assert!(book.unique_identifier.is_none(), "no uuid before commit");
        assert!(!book.has_override);
    }

    #[test]
    fn audiobook_inspection_into_metadata_leaves_the_untagged_fields_empty() {
        let insp = AudiobookInspection {
            title: Some("The Compiled Tales".into()),
            author: Some("Grace Hopper".into()),
            creators: vec!["Grace Hopper".into()],
            has_cover: false,
            format: "mp3".into(),
            part_count: 2,
            duration_seconds: Some(120.0),
            cover_preview: None,
        };
        let book = insp.into_metadata("2 parts selected");
        assert_eq!(book.title.as_deref(), Some("The Compiled Tales"));
        assert_eq!(book.creators.len(), 1);
        assert!(book.series.is_none());
        assert!(book.description.is_none());
        assert!(book.cover_url.is_none());
        assert_eq!(book.formats, vec!["MP3".to_string()]);
    }
}
