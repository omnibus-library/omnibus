//! Render tests for the server-wide key cards and their clear confirm.

use super::*;
use crate::test_support::{render, render_in_vdom};

/// The opening tag of the element carrying `testid`.
fn tag_with_testid<'a>(html: &'a str, testid: &str) -> &'a str {
    let at = html
        .find(&format!(r#"data-testid="{testid}""#))
        .unwrap_or_else(|| panic!("{testid} missing: {html}"));
    let start = html[..at].rfind('<').unwrap();
    &html[start..=at + html[at..].find('>').unwrap()]
}

#[test]
fn secret_key_field_holds_save_until_the_status_loads() {
    let html = render_in_vdom(|| rsx! { SecretKeyField { kind: SecretKeyKind::Hardcover } });
    assert!(html.contains("Hardcover suggestions"), "{html}");
    assert!(html.contains("Save Hardcover key"), "{html}");
    assert!(
        tag_with_testid(&html, "hardcover-save").contains("disabled"),
        "{html}"
    );
}

#[component]
fn ClearHarness() -> Element {
    rsx! {
        ClearCredentialModal {
            testid: "google-books",
            title: "Remove the Google Books key?",
            body: SecretKeyKind::GoogleBooks.clear_consequence(),
            confirm_label: "Remove Google Books key",
            busy: false,
            on_confirm: move |()| {},
            on_cancel: move |()| {},
        }
    }
}

#[test]
fn clear_credential_modal_names_what_clearing_stops() {
    let html = render(rsx! { ClearHarness {} });
    assert!(html.contains("Remove the Google Books key?"), "{html}");
    assert!(html.contains("shared anonymous quota"), "{html}");
    assert!(html.contains("google-books-clear-confirm"), "{html}");
    assert!(html.contains("google-books-clear-cancel"), "{html}");
}
