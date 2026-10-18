//! Tests for the copy button: its label, and what it says once copied.

use super::*;
use crate::test_support::render_in_vdom;

#[test]
fn copy_feedback_says_nothing_before_a_copy() {
    assert_eq!(copy_feedback(None), "");
}

#[test]
fn copy_feedback_confirms_a_copy_that_landed() {
    assert_eq!(copy_feedback(Some(CopyOutcome::Copied)), "Copied");
}

#[test]
fn copy_feedback_asks_for_a_manual_copy_when_the_clipboard_refuses() {
    assert_eq!(
        copy_feedback(Some(CopyOutcome::Failed)),
        "Couldn\u{2019}t copy. Select and copy it."
    );
}

#[test]
fn copy_button_mounts_its_live_region_before_any_copy() {
    let html = render_in_vdom(|| {
        rsx! {
            CopyButton {
                text: "https://omni.example.com/kobo/tok",
                label: "Copy URL",
                testid: "kobo-endpoint-copy",
            }
        }
    });
    assert!(
        html.contains(r#"data-testid="kobo-endpoint-copy""#),
        "{html}"
    );
    assert!(html.contains("Copy URL"), "{html}");
    assert!(
        html.contains(r#"role="status" class="copy-feedback" data-testid="kobo-endpoint-copy-feedback"></span>"#),
        "{html}"
    );
}
