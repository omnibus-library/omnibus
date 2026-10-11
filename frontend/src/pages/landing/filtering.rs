//! Client-side filter predicate for the landing page's shelf lens.
//!
//! Applies the user's [`ViewFilters`] over a shelf pick's member list (see
//! `view::shelf_lens`). Browse is filtered server-side, so only the shelf
//! lens needs this.

use omnibus_shared::{EbookMetadata, ViewFilters};

/// Keep every book the filters don't rule out. A shelf clause can't be decided
/// here, so a filter carrying one rules nothing out.
pub(crate) fn apply_filters(books: &[EbookMetadata], filters: &ViewFilters) -> Vec<EbookMetadata> {
    if filters.is_empty() {
        return books.to_vec();
    }
    books
        .iter()
        .filter(|b| filters.matches(b) != Some(false))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests;
