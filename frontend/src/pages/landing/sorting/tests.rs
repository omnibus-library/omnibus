//! Tests for the landing-page sort helpers: row-slug/row-ident derivation,
//! sort-key wire round-tripping, and the shelf sort-lock reason.

use super::*;
use omnibus_shared::Contributor;

// row_slug cases.
#[test]
fn row_slug_lowercases_and_strips_extension() {
    assert_eq!(row_slug("Alpha.epub"), "alpha");
}
#[test]
fn row_slug_collapses_runs_of_non_alphanumerics() {
    assert_eq!(row_slug("Beta in the Series.epub"), "beta-in-the-series");
}
#[test]
fn row_slug_uses_basename_for_nested_paths() {
    assert_eq!(row_slug("series/vol1/Deep Book.epub"), "deep-book");
}
#[test]
fn row_slug_trims_trailing_dashes() {
    assert_eq!(row_slug("weird---name!!!.epub"), "weird-name");
}
#[test]
fn row_slug_handles_filename_without_extension() {
    assert_eq!(row_slug("plain"), "plain");
}

// contributor_names cases.
#[test]
fn contributor_names_joins_multiple_creators_with_comma_space() {
    let creators = vec![
        Contributor {
            name: "First Author".into(),
            role: None,
            file_as: None,
            id: None,
        },
        Contributor {
            name: "Second Author".into(),
            role: None,
            file_as: None,
            id: None,
        },
    ];
    assert_eq!(contributor_names(&creators), "First Author, Second Author");
}

#[test]
fn contributor_names_returns_empty_string_for_no_creators() {
    assert_eq!(contributor_names(&[]), "");
}

// toggle_dir cases.
#[test]
fn toggle_dir_flips_asc_and_desc() {
    assert_eq!(toggle_dir(SortDir::Asc), SortDir::Desc);
    assert_eq!(toggle_dir(SortDir::Desc), SortDir::Asc);
}

// sort_key_value / sort_key_label / sort_key_from_value cases.
#[test]
fn sort_key_value_delegates_to_the_shared_wire_vocabulary() {
    for key in SORT_KEYS {
        assert_eq!(sort_key_value(key), key.as_wire());
    }
}

#[test]
fn sort_key_label_names_every_sort_key() {
    assert_eq!(sort_key_label(SortKey::Title), "Title");
    assert_eq!(sort_key_label(SortKey::Author), "Author");
    assert_eq!(sort_key_label(SortKey::Series), "Series");
    assert_eq!(sort_key_label(SortKey::LastUpdated), "Last Updated");
    assert_eq!(sort_key_label(SortKey::NewestAdded), "Newest Added");
}

#[test]
fn sort_key_from_value_round_trips_every_sort_key_through_its_wire_value() {
    for key in SORT_KEYS {
        assert_eq!(sort_key_from_value(sort_key_value(key)), Some(key));
    }
}

#[test]
fn sort_key_from_value_returns_none_for_unrecognized_token() {
    assert_eq!(sort_key_from_value("not-a-real-key"), None);
}

/// A book carrying just the two fields `row_ident` reads.
fn ident_book(filename: &str, uuid: &str) -> EbookMetadata {
    EbookMetadata {
        filename: filename.into(),
        unique_identifier: Some(uuid.into()),
        ..EbookMetadata::default()
    }
}

#[test]
fn row_ident_uses_the_filename_slug_for_a_file_backed_book() {
    let b = ident_book("Alpha.epub", "11111111-2222-3333-4444-555555555555");
    assert_eq!(row_ident(&b), "alpha");
}

#[test]
fn row_ident_falls_back_to_the_uuid_for_a_fileless_book() {
    // Two physical-only books both have an empty `filename`; keying on it
    // would collide, so each must fall back to its own uuid.
    let a = ident_book("", "aaaaaaaa-0000-0000-0000-000000000000");
    let b = ident_book("", "bbbbbbbb-0000-0000-0000-000000000000");

    assert_eq!(row_ident(&a), "aaaaaaaa-0000-0000-0000-000000000000");
    assert_ne!(row_ident(&a), row_ident(&b));
}

#[test]
fn row_ident_collides_for_two_books_whose_filenames_share_a_basename() {
    // `filename` is the basename, so shelving `vol.epub` under two folders
    // gives both books one slug. Pinned because it is what `row_diff_key`
    // exists to stop being a page-breaking key (#2633).
    let a = ident_book("vol.epub", "aaaaaaaa-0000-0000-0000-000000000000");
    let b = ident_book("vol.epub", "bbbbbbbb-0000-0000-0000-000000000000");

    assert_eq!(row_ident(&a), row_ident(&b));
}

#[test]
fn row_diff_key_separates_two_books_whose_filenames_share_a_basename() {
    let mut a = ident_book("vol.epub", "aaaaaaaa-0000-0000-0000-000000000000");
    a.id = 17;
    let mut b = ident_book("vol.epub", "bbbbbbbb-0000-0000-0000-000000000000");
    b.id = 18;

    assert_eq!(row_diff_key(&a), "17");
    assert_ne!(row_diff_key(&a), row_diff_key(&b));
}

#[test]
fn row_diff_key_separates_two_fileless_books() {
    let mut a = ident_book("", "aaaaaaaa-0000-0000-0000-000000000000");
    a.id = 4;
    let mut b = ident_book("", "bbbbbbbb-0000-0000-0000-000000000000");
    b.id = 5;

    assert_ne!(row_diff_key(&a), row_diff_key(&b));
}

#[test]
fn sort_lock_reason_names_shelf_order_for_a_hand_picked_shelf() {
    // A manual shelf is ordered `sb.position, sb.added_at` server-side, so
    // the axis and direction reach nothing (#2507).
    assert_eq!(
        sort_lock_reason(Some(omnibus_shared::ShelfKind::Manual)),
        Some("shelf order")
    );
}

#[test]
fn sort_lock_reason_locks_the_wishlist_too() {
    // The wishlist is ordered `we.added_at DESC` on the same grounds.
    assert_eq!(
        sort_lock_reason(Some(omnibus_shared::ShelfKind::Wishlist)),
        Some("shelf order")
    );
}

#[test]
fn sort_lock_reason_leaves_a_smart_shelf_and_the_whole_library_sortable() {
    assert_eq!(
        sort_lock_reason(Some(omnibus_shared::ShelfKind::Smart)),
        None
    );
    assert_eq!(sort_lock_reason(None), None);
}

#[test]
fn slugify_lowercases_and_collapses_runs_of_other_characters() {
    assert_eq!(slugify("Code Quartet"), "code-quartet");
    assert_eq!(slugify("  Dr. Who? "), "dr-who");
    assert_eq!(slugify("Pioneers"), "pioneers");
}
