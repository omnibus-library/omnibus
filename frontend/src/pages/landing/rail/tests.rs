//! Unit tests for the rail's inclusion rule as it applies to a persisted pick.

use omnibus_shared::{ShelfKind, ShelfSummary, Visibility};

use super::*;

fn summary(owner_user_id: i64, kind: ShelfKind) -> ShelfSummary {
    ShelfSummary {
        id: 7,
        owner_user_id,
        owner_username: "elena".into(),
        owner_has_avatar: false,
        kind,
        name: "Lunch Break Picks".into(),
        visibility: Visibility::Private,
        accent: None,
        book_count: 0,
        cover_uuids: Vec::new(),
    }
}

fn on_rail(
    id: i64,
    owner_user_id: i64,
    kind: ShelfKind,
    visibility: Visibility,
    books: i64,
) -> ShelfSummary {
    ShelfSummary {
        id,
        visibility,
        book_count: books,
        ..summary(owner_user_id, kind)
    }
}

fn pick(id: i64) -> ShelfSelection {
    ShelfSelection::Shelf(id)
}

#[test]
fn selection_off_rail_holds_for_a_pick_the_rail_no_longer_shows() {
    let viewer = Some(1);
    let all = [
        on_rail(1, 1, ShelfKind::Wishlist, Visibility::Private, 0),
        on_rail(2, 2, ShelfKind::Manual, Visibility::Private, 3),
        on_rail(3, 2, ShelfKind::Wishlist, Visibility::Public, 5),
    ];
    // The viewer's emptied wishlist, another reader's private shelf and another
    // reader's wishlist are all in the list but not on the rail; 99 is in neither.
    for id in [1, 2, 3, 99] {
        assert!(selection_off_rail(pick(id), &all, viewer), "shelf {id}");
    }
}

#[test]
fn selection_off_rail_is_false_for_all_books_and_for_a_shelf_on_the_rail() {
    let viewer = Some(1);
    let all = [
        on_rail(1, 1, ShelfKind::Wishlist, Visibility::Private, 2),
        on_rail(2, 2, ShelfKind::Manual, Visibility::Public, 3),
    ];
    assert!(!selection_off_rail(ShelfSelection::All, &all, viewer));
    assert!(!selection_off_rail(pick(1), &all, viewer));
    assert!(!selection_off_rail(pick(2), &all, viewer));
}

#[test]
fn selection_off_rail_never_resets_a_pick_while_the_viewer_is_unknown() {
    let all = [on_rail(1, 1, ShelfKind::Wishlist, Visibility::Private, 0)];
    assert!(!selection_off_rail(pick(1), &all, None));
    assert!(!selection_off_rail(pick(99), &all, None));
}
