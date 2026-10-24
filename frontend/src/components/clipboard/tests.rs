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

#[test]
fn readonly_copy_field_labels_a_readonly_input_and_wires_the_copy_button() {
    let html = render_in_vdom(|| {
        rsx! {
            ReadonlyCopyField {
                id: "kosync-url",
                label: "Server URL",
                value: "https://omni.example.com/kosync",
                input_testid: "kosync-url",
                copy_label: "Copy",
                copy_testid: "kosync-url-copy",
                copy_aria_label: "Copy the server URL",
            }
        }
    });
    for expected in [
        r#"<label for="kosync-url">Server URL</label>"#,
        r#"id="kosync-url""#,
        r#"data-testid="kosync-url""#,
        "readonly",
        r#"value="https://omni.example.com/kosync""#,
        r#"data-testid="kosync-url-copy""#,
        r#"aria-label="Copy the server URL""#,
    ] {
        assert!(html.contains(expected), "missing {expected}: {html}");
    }
}
