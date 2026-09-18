//! Where a cover write goes. The edit page's two cover surfaces — the
//! sidebar editor and the compare view's cover row — write against a saved
//! book the moment a cover is picked. The upload review form reuses both
//! surfaces over a book that does not exist yet, so there they stage into a
//! signal the commit request carries instead.

use dioxus::prelude::*;

use crate::data::{self, UploadCover};

/// A cover chosen during review, not yet written anywhere.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct StagedCover {
    /// The inspected file's own cover preview, kept so "use the file's
    /// cover" can put it back after a pick.
    pub(crate) original_preview: Option<String>,
    /// What the surfaces show now: the file's preview, an object URL for a
    /// picked image, or the provider's image URL.
    pub(crate) preview: Option<String>,
    /// What the commit will send.
    pub(crate) source: UploadCover,
}

impl StagedCover {
    /// Start from what the inspection showed.
    pub(crate) fn from_inspection(preview: Option<String>) -> Self {
        Self {
            original_preview: preview.clone(),
            preview,
            source: UploadCover::Keep,
        }
    }

    /// Replace the staged cover and what the surfaces show for it.
    pub(crate) fn stage(&mut self, source: UploadCover, preview: Option<String>) {
        self.release_preview();
        self.source = source;
        self.preview = preview;
    }

    /// Back to the file's own cover.
    pub(crate) fn reset(&mut self) {
        self.release_preview();
        self.source = UploadCover::Keep;
        self.preview = self.original_preview.clone();
    }

    /// Let go of a picked image's object URL before it is replaced — the
    /// file's own preview is a `data:` URL, which this leaves alone.
    fn release_preview(&self) {
        if let Some(url) = &self.preview {
            if self.original_preview.as_deref() != Some(url.as_str()) {
                data::revoke_preview_url(url);
            }
        }
    }

    /// Whether the commit will carry a cover of its own.
    pub(crate) fn is_staged(&self) -> bool {
        self.source != UploadCover::Keep
    }
}

/// Which of the two cover targets a surface writes to.
#[derive(Clone, PartialEq)]
pub(crate) enum CoverMode {
    /// A saved book: writes go to `/api/ebooks/:uuid/cover` immediately.
    Live { uuid: String },
    /// A book under review: writes stage here and land at commit.
    Staged(Signal<StagedCover>),
}

impl CoverMode {
    /// The saved book's uuid, or `None` under review — the cache-bust
    /// registry and the cover routes are keyed on it, and neither applies to
    /// a book that has no route yet.
    pub(crate) fn uuid(&self) -> Option<&str> {
        match self {
            CoverMode::Live { uuid } => Some(uuid),
            CoverMode::Staged(_) => None,
        }
    }
}
