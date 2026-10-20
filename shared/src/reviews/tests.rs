//! `ReviewPatch` absent-vs-null decoding and validation.

use super::*;

#[test]
fn review_patch_reads_an_absent_field_as_unchanged_and_null_as_cleared() {
    let patch: ReviewPatch =
        serde_json::from_str(r#"{"stars": null, "body_md": "Loved it"}"#).unwrap();
    assert_eq!(patch.stars, Some(None));
    assert_eq!(patch.body_md, Some(Some("Loved it".to_string())));
    assert_eq!(patch.notes_md, None);
    assert_eq!(patch.spoiler, None);
}

#[test]
fn review_patch_reads_a_null_spoiler_as_left_out() {
    let patch: ReviewPatch = serde_json::from_str(r#"{"spoiler": null}"#).unwrap();
    assert_eq!(patch.spoiler, None);
    assert_eq!(patch, ReviewPatch::default());
}

#[test]
fn review_patch_serializes_back_to_the_same_absent_and_null_fields() {
    let patch = ReviewPatch {
        stars: Some(None),
        spoiler: Some(true),
        ..Default::default()
    };
    let json = serde_json::to_value(&patch).unwrap();
    assert_eq!(json, serde_json::json!({"stars": null, "spoiler": true}));
}

#[test]
fn review_patch_validate_accepts_half_stars_and_a_cleared_rating() {
    for stars in [Some(Some(0.5)), Some(Some(4.5)), Some(None), None] {
        let patch = ReviewPatch {
            stars,
            ..Default::default()
        };
        assert!(patch.validate().is_ok(), "{stars:?} should be valid");
    }
}

#[test]
fn review_patch_validate_rejects_stars_off_the_half_star_scale() {
    for stars in [0.0, 0.3, 5.5, f32::NAN] {
        let patch = ReviewPatch {
            stars: Some(Some(stars)),
            ..Default::default()
        };
        assert!(patch.validate().is_err(), "{stars} should be rejected");
    }
}

#[test]
fn review_patch_validate_rejects_text_or_notes_over_the_byte_cap() {
    let long = "x".repeat(REVIEW_TEXT_MAX_LEN + 1);
    let body = ReviewPatch {
        body_md: Some(Some(long.clone())),
        ..Default::default()
    };
    let notes = ReviewPatch {
        notes_md: Some(Some(long)),
        ..Default::default()
    };
    assert!(body.validate().unwrap_err().contains("body_md"));
    assert!(notes.validate().unwrap_err().contains("notes_md"));
}
