//! Serde/token round-trip tests, `UpdateCopyNoteRequest::validate` length-cap
//! coverage, and the `PhysicalCopy::can_change` ownership rule.

use super::*;

#[test]
fn wishlist_source_round_trips_through_the_db_string_for_every_variant() {
    for variant in [
        WishlistSource::Scan,
        WishlistSource::Detail,
        WishlistSource::Manual,
        WishlistSource::Search,
    ] {
        assert_eq!(
            WishlistSource::from_db(variant.as_str()),
            Some(variant),
            "variant {variant:?} did not round-trip through as_str/from_db"
        );
    }
}

#[test]
fn wishlist_source_from_db_returns_none_for_unrecognized_token() {
    assert_eq!(WishlistSource::from_db("bogus"), None);
}

#[test]
fn update_copy_note_request_validate_accepts_a_missing_note() {
    let req = UpdateCopyNoteRequest { note: None };
    assert!(req.validate().is_ok());
}

#[test]
fn update_copy_note_request_validate_accepts_a_well_formed_note() {
    let req = UpdateCopyNoteRequest {
        note: Some("1st edition, dust jacket a little worn.".into()),
    };
    assert!(req.validate().is_ok());
}

#[test]
fn update_copy_note_request_validate_rejects_an_oversized_note() {
    let req = UpdateCopyNoteRequest {
        note: Some("x".repeat(UpdateCopyNoteRequest::NOTE_MAX_LEN + 1)),
    };
    let err = req.validate().expect_err("oversized note must be rejected");
    assert!(err.contains("note"), "got: {err}");
}

fn copy_filed_by(user: Option<i64>) -> PhysicalCopy {
    PhysicalCopy {
        id: 1,
        book_uuid: "u".into(),
        isbn: None,
        added_by_user_id: user,
        added_by_name: None,
        checked_in_at: 0,
        checked_in_at_iso: None,
        note: None,
    }
}

#[test]
fn physical_copy_can_change_allows_the_reader_who_filed_it() {
    assert!(copy_filed_by(Some(7)).can_change(7, false));
}

#[test]
fn physical_copy_can_change_allows_an_admin_on_anyones_copy() {
    assert!(copy_filed_by(Some(7)).can_change(8, true));
    assert!(copy_filed_by(None).can_change(8, true));
}

#[test]
fn physical_copy_can_change_denies_another_reader_and_an_orphaned_copy() {
    assert!(!copy_filed_by(Some(7)).can_change(8, false));
    assert!(!copy_filed_by(None).can_change(8, false));
}
