//! Tests for the shared shelf tile: the words it speaks, the owner label a
//! viewer reads, its accent and size classes, and what its face draws.
//! Needs the `server` feature (`dioxus::ssr`).

use omnibus_shared::{ShelfKind, Visibility};

use super::*;
use crate::test_support::{render_in_vdom, test_shelf_summary};

const VIEWER_ID: i64 = 7;

#[test]
fn kind_label_names_each_kind_in_a_word() {
    assert_eq!(kind_label(ShelfKind::Smart), "Smart");
    assert_eq!(kind_label(ShelfKind::Manual), "Hand-picked");
    assert_eq!(kind_label(ShelfKind::Wishlist), "Wishlist");
}

#[test]
fn visibility_label_names_each_visibility_in_a_word() {
    assert_eq!(visibility_label(Visibility::Private), "Private");
    assert_eq!(visibility_label(Visibility::Public), "Public");
}

#[test]
fn book_count_label_pluralises_every_count_but_one() {
    assert_eq!(book_count_label(0), "0 books");
    assert_eq!(book_count_label(1), "1 book");
    assert_eq!(book_count_label(24), "24 books");
}

#[test]
fn empty_ledge_label_speaks_in_the_kinds_own_terms() {
    assert_eq!(empty_ledge_label(ShelfKind::Smart), "No matches yet");
    assert_eq!(empty_ledge_label(ShelfKind::Manual), "Empty shelf");
    assert_eq!(empty_ledge_label(ShelfKind::Wishlist), "Nothing wished for");
}

#[test]
fn accent_style_sets_the_shelf_accent_or_falls_back_to_the_app_accent() {
    let mut shelf = test_shelf_summary(1, VIEWER_ID, ShelfKind::Manual, "Beach");
    assert_eq!(accent_style(&shelf), "--shelf-accent: var(--accent);");
    shelf.accent = Some("oklch(0.7 0.1 40)".into());
    assert_eq!(accent_style(&shelf), "--shelf-accent: oklch(0.7 0.1 40);");
}

#[test]
fn tile_class_adds_the_compact_modifier_only_when_asked() {
    assert_eq!(tile_class(false), "shv-card");
    assert_eq!(tile_class(true), "shv-card shv-card--compact");
}

#[test]
fn viewer_owner_label_says_you_for_the_viewers_own_shelf() {
    let shelf = test_shelf_summary(1, VIEWER_ID, ShelfKind::Manual, "Beach");
    assert_eq!(viewer_owner_label(Some(VIEWER_ID), &shelf), "You");
}

#[test]
fn viewer_owner_label_attributes_another_readers_shelf_to_them() {
    let shelf = test_shelf_summary(1, 9, ShelfKind::Manual, "Theirs");
    assert_eq!(viewer_owner_label(Some(VIEWER_ID), &shelf), "by user-9");
}

#[test]
fn viewer_owner_label_names_another_readers_wishlist_without_a_by() {
    let shelf = test_shelf_summary(1, 9, ShelfKind::Wishlist, "user-9's wishlist");
    assert_eq!(viewer_owner_label(Some(VIEWER_ID), &shelf), "user-9");
}

#[test]
fn viewer_owner_label_names_the_owner_plainly_before_the_viewer_is_known() {
    let shelf = test_shelf_summary(1, 9, ShelfKind::Manual, "Theirs");
    assert_eq!(viewer_owner_label(None, &shelf), "user-9");
}

fn face_with_covers() -> Element {
    let mut shelf = test_shelf_summary(3, 9, ShelfKind::Smart, "Austen");
    shelf.book_count = 12;
    shelf.cover_uuids = vec!["u1".into(), "u2".into()];
    rsx! {
        ShelfTileFace {
            shelf,
            owner_label: "by user-9".to_string(),
            server_url: String::new(),
            avatar_bust: 0,
        }
    }
}

#[test]
fn shelf_tile_face_stands_the_covers_and_names_kind_count_and_owner() {
    let html = render_in_vdom(face_with_covers);
    assert!(html.contains("/api/thumbs/u1/sm"), "{html}");
    assert!(html.contains("/api/thumbs/u2/sm"), "{html}");
    assert!(html.contains(">Austen<"), "{html}");
    assert!(html.contains("Smart"), "{html}");
    assert!(html.contains("Private"), "{html}");
    assert!(html.contains("12 books"), "{html}");
    assert!(html.contains(">by user-9<"), "{html}");
}
