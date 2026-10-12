//! Rough word-count estimate for an already-parsed EPUB. `db::stats::pages`
//! reads the stored figure as the weakest rung of its length ladder — used only
//! when a book has neither a print-edition page count nor a comic's exact image
//! count — and converts it to pages at 275 words each.

use epub::doc::EpubDoc;

/// Elements whose text content is markup, not prose. [`strip_tags`] drops what
/// is *between* their tags as well as the tags themselves; counting a
/// stylesheet's selectors or a script's identifiers as words inflated the
/// estimate of every book that inlines either.
const SUPPRESSED_ELEMENTS: [&str; 2] = ["script", "style"];

/// `epub:type` declarations that mark a document as navigation rather than
/// reading, as literal attribute text in both quote styles. The manifest's
/// `properties="nav"` covers EPUB 3, but an EPUB 2 HTML table of contents is an
/// ordinary spine item, so its own declaration is the only signal available.
// Fixed patterns, spelled out: this runs for every document of every book on an
// index or backfill, so no per-item `format!`.
const NAV_EPUB_TYPE_ATTRS: [&str; 6] = [
    "epub:type=\"toc\"",
    "epub:type='toc'",
    "epub:type=\"landmarks\"",
    "epub:type='landmarks'",
    "epub:type=\"page-list\"",
    "epub:type='page-list'",
];

/// Estimate a book's total word count by walking every spine item's HTML
/// resource, stripping markup, and counting whitespace-separated tokens. `None`
/// when the epub has no spine or every resource fails to load: "couldn't
/// estimate", not a fabricated zero, so stats can tell it from a zero-length
/// book. Navigation documents are skipped (a ToC would double-count headings).
pub fn estimate_word_count<R: std::io::Read + std::io::Seek>(doc: &mut EpubDoc<R>) -> Option<i64> {
    let nav_id = doc.get_nav_id();
    let ids: Vec<(String, bool)> = doc
        .spine
        .iter()
        .map(|item| {
            let is_nav = nav_id.as_deref() == Some(item.idref.as_str())
                || declares_property(item.properties.as_deref(), "nav");
            (item.idref.clone(), is_nav)
        })
        .collect();
    if ids.is_empty() {
        return None;
    }
    let mut total: i64 = 0;
    let mut loaded_any = false;
    for (id, is_nav) in ids {
        let Some((html, _mime)) = doc.get_resource_str(&id) else {
            continue;
        };
        // Counted as loaded even when skipped: a book whose spine is nothing
        // but navigation was read successfully and estimates at zero, which is
        // a different fact from one whose resources wouldn't open at all.
        loaded_any = true;
        if is_nav || is_navigation_document(&html) {
            continue;
        }
        total += strip_tags(&html).split_whitespace().count() as i64;
    }
    loaded_any.then_some(total)
}

/// Whether a space-separated `properties` attribute carries `wanted`.
/// Belt-and-braces for a malformed package: the attribute here is the spine
/// `itemref`'s, where a well-formed EPUB never declares `nav` (a *manifest*
/// item property, already read by `EpubDoc::get_nav_id`).
fn declares_property(properties: Option<&str>, wanted: &str) -> bool {
    properties.is_some_and(|ps| ps.split_ascii_whitespace().any(|p| p == wanted))
}

/// Whether a content document declares itself navigation via `epub:type`.
/// A substring test rather than a parse: this runs once per spine item during
/// an index, and no chapter of prose carries `epub:type="toc"` by accident.
fn is_navigation_document(html: &str) -> bool {
    NAV_EPUB_TYPE_ATTRS.iter().any(|attr| html.contains(attr))
}

/// Strip markup for word counting: the shared walk with the
/// [`SUPPRESSED_ELEMENTS`] and no block-boundary newlines, so stored counts
/// are unchanged by the walk being shared with `ebook::text`.
fn strip_tags(html: &str) -> String {
    super::strip::strip_markup(html, &SUPPRESSED_ELEMENTS, false)
}

#[cfg(test)]
mod tests;
