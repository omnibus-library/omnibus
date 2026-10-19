//! Landing page (`/`) — the primary library surface. See [`LandingPage`] for
//! the keyset-browse + shelf-lens split. View mode + sort + filters persist
//! per library path via [`crate::view_prefs`]. Split into [`signals`]
//! (reactive state + fetch wiring), [`view`] (per-render derived state +
//! handlers), and [`body`] (mobile/web presentation).

use dioxus::prelude::*;

use crate::use_server_url;

mod effects;
pub(crate) mod resume_meta;
mod sorting;

// Web-only presentation cluster (hero + gallery + toolbar + table/grid). The
// mobile build renders `mobile::MobileLanding` instead and never pulls these in.
#[cfg(not(feature = "mobile"))]
mod bulk_edit;
#[cfg(not(feature = "mobile"))]
mod filters;
#[cfg(not(feature = "mobile"))]
mod grid;
#[cfg(not(feature = "mobile"))]
mod sections;
#[cfg(not(feature = "mobile"))]
mod series_grid;
#[cfg(not(feature = "mobile"))]
mod series_tiles;
#[cfg(not(feature = "mobile"))]
mod shelf_gallery;
#[cfg(not(feature = "mobile"))]
mod stack;
#[cfg(not(feature = "mobile"))]
mod stack_toggle;
#[cfg(not(feature = "mobile"))]
mod table;
#[cfg(not(feature = "mobile"))]
mod toolbar;

#[cfg(feature = "mobile")]
mod mobile;
#[cfg(feature = "mobile")]
mod mobile_filter_sheet;
#[cfg(feature = "mobile")]
mod pull_refresh;

mod body;
mod signals;
mod view;

// The mobile shelf-detail grid reuses the landing grid's cover cell so the
// two surfaces stay visually identical.
#[cfg(feature = "mobile")]
pub(crate) use mobile::cover_cell as mobile_cover_cell;

#[cfg(feature = "mobile")]
use body::mobile_landing_body;
#[cfg(not(feature = "mobile"))]
use body::web_landing_body;
use signals::setup_landing_signals;
use view::derive_view_state;

/// Keyset page size for the browse path. A grid renders
/// ~30–60 cards above the fold and the table more; 100 covers both without an
/// oversized first paint.
pub(super) const PAGE_SIZE: i64 = 100;

/// Landing page — primary library surface.
///
/// Browse is keyset-paginated server-side: the first page carries the total under
/// the active filters and exclusion, "Load more" appends the rest, and changing sort
/// or filter refetches page 1. A gallery pick shows that shelf's server-narrowed members.
#[component]
pub fn LandingPage() -> Element {
    let server_url = use_server_url();
    let sigs = setup_landing_signals(&server_url);
    let view = derive_view_state(&sigs);
    let handlers = view::build_handlers(&sigs);

    // Restore scroll on back-navigation once page 1 has loaded. The paginated
    // list is short on a fresh remount, so the restore retries across frames
    // while the load-more observer streams pages in toward the saved offset
    // (see `crate::scroll_restore`).
    let loading = sigs.loading;
    let content_ready = use_memo(move || !loading());
    crate::scroll_restore::use_scroll_restore(content_ready);

    // Mobile renders a dedicated "All Books" surface; web keeps the
    // rail + toolbar layout. Both consume the shared data pipeline above —
    // only the presentation branches. (Mobile is a separate build, so this
    // cfg split doesn't affect web SSR/WASM hydration parity — rule 07.)
    #[cfg(feature = "mobile")]
    let result = mobile_landing_body(&sigs, view, handlers, server_url);

    #[cfg(not(feature = "mobile"))]
    let result = web_landing_body(&sigs, view, handlers, server_url);

    result
}

#[cfg(all(test, not(feature = "mobile")))]
mod tests {
    use super::*;

    fn book_with_uuid(uuid: &str, publisher: &str) -> omnibus_shared::EbookMetadata {
        omnibus_shared::EbookMetadata {
            unique_identifier: Some(uuid.to_string()),
            publisher: Some(publisher.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn selected_bulk_books_gathers_from_both_lists_without_duplicates() {
        use std::collections::BTreeSet;

        let selected: BTreeSet<String> = ["a".to_string(), "b".to_string()].into();
        let books = vec![book_with_uuid("a", "P1"), book_with_uuid("c", "P3")];
        let shelf = vec![book_with_uuid("a", "P1"), book_with_uuid("b", "P2")];
        let found = body::selected_bulk_books(&selected, &books, Some(&shelf));
        let uuids: Vec<_> = found
            .iter()
            .filter_map(|b| b.unique_identifier.clone())
            .collect();
        assert_eq!(uuids, vec!["a", "b"]);
    }

    #[test]
    fn replace_updated_books_replaces_matching_uuids_and_keeps_the_rest() {
        let mut list = vec![book_with_uuid("a", "Old"), book_with_uuid("c", "Keep")];
        body::replace_updated_books(&mut list, &[book_with_uuid("a", "New")]);
        assert_eq!(list[0].publisher.as_deref(), Some("New"));
        assert_eq!(list[1].publisher.as_deref(), Some("Keep"));
    }
}
