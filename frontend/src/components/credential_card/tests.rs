//! Tests for the settings-card status helpers: the credential dot line's
//! states and the result line mounted before its first message.

use crate::test_support::render;

use super::*;

#[test]
fn credential_status_line_checks_rather_than_claims_missing_before_the_read() {
    let html = render(credential_status_line(
        "k",
        None,
        false,
        "Connected",
        "Not connected",
    ));
    assert!(html.contains("api-key-dot pending"), "{html}");
    assert!(html.contains("ld-sheen"), "{html}");
    assert!(!html.contains("Not connected"), "{html}");
}

#[test]
fn credential_status_line_reports_each_answered_state() {
    let on = render(credential_status_line(
        "k",
        Some(true),
        false,
        "Connected",
        "Not connected",
    ));
    assert!(
        on.contains("api-key-dot connected") && on.contains("Connected"),
        "{on}"
    );
    let off = render(credential_status_line(
        "k",
        Some(false),
        false,
        "Connected",
        "Not connected",
    ));
    assert!(
        off.contains("Not connected") && !off.contains("pending"),
        "{off}"
    );
}

#[test]
fn live_status_mounts_empty_before_any_message() {
    let html = render(live_status("s", None, false));
    assert_eq!(
        html,
        r#"<p role="status" class="settings-status" data-testid="s"></p>"#
    );
}

#[test]
fn live_status_marks_a_failure_as_an_error() {
    let html = render(live_status("s", Some("Nope."), true));
    assert!(html.contains(r#"class="settings-status error""#), "{html}");
    assert!(html.contains("Nope."), "{html}");
}

#[test]
fn credential_status_line_stops_checking_once_the_read_has_failed() {
    let html = render(credential_status_line(
        "k",
        None,
        true,
        "Connected",
        "Not connected",
    ));
    assert!(html.contains("Status unavailable"), "{html}");
    assert!(!html.contains("ld-sheen"), "{html}");
    assert!(!html.contains("Not connected"), "{html}");
}
