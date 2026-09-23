//! Where the EPUB reader opens, decided once from what the server and this
//! device know. Shared by the web and mobile interops, which differ only in
//! how they mount the glue.

use omnibus_shared::{is_epub_cfi, ProgressRecord};

/// The opening position, and whether the first landing may be written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReaderStart {
    /// The CFI to restore, or `None` to open at the start of the book.
    pub cfi: Option<String>,
    /// Set when the reader opens at the start while the server holds a
    /// position further in that it could not place. The first landing is
    /// where the reader was put, not where it went — writing it would put
    /// the cover over the stored percent.
    pub hold_first_write: bool,
}

/// Resolve the opening position: a `?cfi=` deep link outright, else the
/// server's own CFI, else the CFI the server derived for a percent-only row,
/// else this device's last local save.
///
/// The server's row outranks the local save because an accepted write
/// replaces the whole row: a percent-only row is newer than any CFI this
/// client managed to post. Anything that is not an epub CFI — a PDF's
/// `pdf-page:N` on a mixed book — never reaches epub.js.
pub(crate) fn reader_start(
    deep_link: Option<String>,
    record: Option<&ProgressRecord>,
    local_saved: Option<String>,
) -> ReaderStart {
    if let Some(cfi) = deep_link {
        return ReaderStart {
            cfi: Some(cfi),
            hold_first_write: false,
        };
    }
    let placeable = |c: &Option<String>| c.clone().filter(|c| is_epub_cfi(c));
    let cfi = record
        .and_then(|r| placeable(&r.epub_cfi).or_else(|| placeable(&r.derived_epub_cfi)))
        .or(local_saved);
    let stored_further_in = record
        .and_then(|r| r.progress_percent)
        .is_some_and(|p| (1..=100).contains(&p));
    ReaderStart {
        hold_first_write: cfi.is_none() && stored_further_in,
        cfi,
    }
}

#[cfg(test)]
mod tests;
