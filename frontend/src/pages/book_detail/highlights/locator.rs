//! Derive a human-readable locator from a highlight's anchor. A highlight
//! stores only its anchor — an EPUB CFI range, or a PDF `pdf:{page}:{quads}`
//! anchor; the book-detail page maps that to the chapter the reader names
//! for the same position, and falls back to the raw spine "Section N" (or
//! the PDF's "Page N") otherwise.

use omnibus_shared::{pdf_anchor_page, AlignmentEbookChapter};

use crate::pages::book_detail::chapter_ref;

/// Human locator for a highlight's CFI: the **chapter's title**, not its ordinal
/// (a TOC counts front matter), resolved via `chapter_ref` as the resume readout
/// does. Falls back to the 1-based spine "Section N" with no chapter structure,
/// before the first chapter, or on an untitled chapter. `None` when the CFI has
/// no readable spine step; the caller then shows the saved date alone.
pub(super) fn highlight_locator(cfi: &str, chapters: &[AlignmentEbookChapter]) -> Option<String> {
    if let Some(page) = pdf_anchor_page(cfi) {
        return Some(pdf_locator(page, chapters));
    }
    let titled = chapter_ref::chapter_index_for_cfi(chapters, cfi)
        .and_then(|idx| chapters.get(idx))
        .map(|c| c.title.trim())
        .filter(|t| !t.is_empty());
    if let Some(title) = titled {
        return Some(title.to_string());
    }
    chapter_ref::cfi_spine_ordinal(cfi).map(|n| format!("Section {n}"))
}

/// Locator for a PDF anchor on 0-based `page`. A PDF's structure rows are
/// one spine entry per page, so an outline entry's `spine_index` is the page
/// it points at: the last titled entry at or before the page names it, the
/// way the EPUB arm names a chapter. With no outline (or none reaching this
/// page) it is "Page N", 1-based — what the reader's own footer shows.
fn pdf_locator(page: usize, chapters: &[AlignmentEbookChapter]) -> String {
    let titled = chapters
        .iter()
        .rposition(|c| c.spine_index <= page as i64)
        .and_then(|idx| chapters.get(idx))
        .map(|c| c.title.trim())
        .filter(|t| !t.is_empty());
    match titled {
        Some(title) => title.to_string(),
        None => format!("Page {}", page + 1),
    }
}
