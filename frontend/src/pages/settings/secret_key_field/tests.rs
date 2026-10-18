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

#[test]
fn clear_warning_names_what_clearing_stops_and_that_it_cannot_be_read_back() {
    let warning = clear_warning(SecretKeyKind::GoogleBooks);
    assert!(warning.contains("shared anonymous quota"), "{warning}");
    assert!(warning.contains("can\u{2019}t be shown again"), "{warning}");
}
