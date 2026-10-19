//! Parsed ebook metadata plus the user-supplied override layer.
//! `Contributor` / `Identifier` / `EbookMetadata` are the wire shape for a
//! single book row; `MetadataOverrides` is the JSON-serialized layer persisted
//! in `metadata_overrides.overrides` and merged on read. Re-exports flatten so
//! callers keep `omnibus_shared::EbookMetadata`.

mod chapters;
mod images;
mod metadata;
mod overrides;
mod validator;

#[cfg(test)]
mod tests;

pub use chapters::{
    ChapterListEntry, ChapterListResponse, ChapterTextQuery, ChapterTextResponse,
    CHAPTER_TEXT_MAX_CHARS,
};
pub use images::{
    BookImage, BookImageLink, BookImageList, BookImageRead, BookImageReference, ImageHrefQuery,
    SignedImageQuery,
};
pub use metadata::{BookFileInfo, Contributor, EbookFileQuery, EbookMetadata, Identifier};
pub use overrides::{
    BulkMetadataEdit, BulkRewriteError, BulkRewriteSummary, CoverFromUrlBody, CoverUploadForm,
    MetadataOverrides,
};
pub use validator::{
    file_etag, DownloadFormat, DownloadValidator, DownloadValidatorQuery, DownloadValidatorRequest,
    DownloadValidatorResponse, MAX_VALIDATOR_QUERY,
};

/// Resolves a display title: the given title if set, otherwise the filename.
pub fn display_title(title: Option<&str>, filename: &str) -> String {
    title
        .map(str::to_owned)
        .unwrap_or_else(|| filename.to_owned())
}
