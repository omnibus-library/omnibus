//! Which shelves the library's shelves row carries, and whether a persisted
//! shelf pick still names one. Compiled on every target: the pick is restored by
//! `signals` on the web landing and the mobile one alike, though only the web
//! build draws the row ([`super::shelf_gallery`]).

use omnibus_shared::{ShelfKind, ShelfSummary, Visibility};

use crate::shelf_selection::ShelfSelection;

/// Which shelves the row shows, mirroring the iOS rail's `railShelves`: the
/// viewer's own plus other readers' *shared* shelves, minus any wishlist nobody
/// has put a book in. The server's order is kept and, unlike iOS, there is
/// **no cap**, as this row pages horizontally. `viewer_id` is `None` until the
/// boot effect resolves; nothing counts as "yours" until it lands.
pub(super) fn rail_shelves(all: &[ShelfSummary], viewer_id: Option<i64>) -> Vec<ShelfSummary> {
    all.iter()
        // Excluded on purpose: another reader's private shelf (only an admin's read
        // returns one), their auto-provisioned wishlist (noise), and the viewer's own
        // empty wishlist.
        .filter(|s| {
            let is_own = viewer_id == Some(s.owner_user_id);
            let shared_by_another = s.visibility == Visibility::Public && !s.kind.is_system();
            let unused_wishlist = s.kind == ShelfKind::Wishlist && s.book_count == 0;
            (is_own || shared_by_another) && !unused_wishlist
        })
        .cloned()
        .collect()
}

/// Whether a persisted gallery pick names a shelf the rail no longer shows: gone,
/// emptied (the viewer's own wishlist) or no longer shared. Never true while the
/// viewer is unknown, since the rail withholds every "yours" until they land.
pub(super) fn selection_off_rail(
    selection: ShelfSelection,
    all: &[ShelfSummary],
    viewer_id: Option<i64>,
) -> bool {
    let ShelfSelection::Shelf(id) = selection else {
        return false;
    };
    viewer_id.is_some() && !rail_shelves(all, viewer_id).iter().any(|s| s.id == id)
}

#[cfg(test)]
mod tests;
