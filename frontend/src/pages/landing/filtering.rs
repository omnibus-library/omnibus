//! Client-side filter predicate for the landing page's shelf lens.
//!
//! Applies the user's [`ViewFilters`] over a shelf pick's member list (see
//! `view::shelf_lens`). Browse is filtered server-side, so only the shelf
//! lens needs this.

use omnibus_shared::{EbookMetadata, ViewFilters};

fn matches_filters(book: &EbookMetadata, filters: &ViewFilters) -> bool {
    // Allocation-free membership checks: filter buckets are typically tiny
    // (a handful of selected chips), so a nested `any().any()` is faster
    // than building a fresh HashSet per book on every filter pass.
    if !filters.authors.is_empty()
        && !filters
            .authors
            .iter()
            .any(|a| book.creators.iter().any(|c| &c.name == a))
    {
        return false;
    }
    if !filters.series.is_empty() {
        let series = book.series.as_deref().unwrap_or("");
        if !filters.series.iter().any(|s| s == series) {
            return false;
        }
    }
    if !filters.formats.is_empty()
        && !filters
            .formats
            .iter()
            .any(|f| book.formats.iter().any(|bf| bf.eq_ignore_ascii_case(f)))
    {
        return false;
    }
    if !filters.tags.is_empty()
        && !filters
            .tags
            .iter()
            .any(|t| book.subjects.iter().any(|s| s == t))
    {
        return false;
    }
    if !filters.genres.is_empty()
        && !filters
            .genres
            .iter()
            .any(|g| book.genres.iter().any(|bg| bg == g))
    {
        return false;
    }
    true
}

/// Keep only the books matching every active filter. An empty filter set
/// clones the input through unchanged.
pub(crate) fn apply_filters(books: &[EbookMetadata], filters: &ViewFilters) -> Vec<EbookMetadata> {
    if filters.is_empty() {
        return books.to_vec();
    }
    books
        .iter()
        .filter(|b| matches_filters(b, filters))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests;
