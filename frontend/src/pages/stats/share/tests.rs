//! Tests for the Stats page's household-sharing switch.

use super::*;
use crate::test_support::{provide_current_user, render_in_vdom, test_user};

#[component]
fn UnresolvedHost() -> Element {
    provide_current_user(None);
    rsx! { ShareStatsToggle {} }
}

#[component]
fn SharingHost() -> Element {
    provide_current_user(Some(Some(test_user(false, false))));
    rsx! { ShareStatsToggle {} }
}

#[component]
fn PrivateHost() -> Element {
    let user = omnibus_shared::UserSummary {
        share_stats: false,
        ..test_user(false, false)
    };
    provide_current_user(Some(Some(user)));
    rsx! { ShareStatsToggle {} }
}

#[test]
fn share_stats_toggle_waits_at_unknown_until_the_viewer_resolves() {
    let html = render_in_vdom(UnresolvedHost);

    assert!(
        html.contains("data-testid=\"stats-share-toggle\""),
        "{html}"
    );
    assert!(html.contains("ld-unknown"), "{html}");
    assert!(html.contains("disabled"), "{html}");
}

#[test]
fn share_stats_toggle_is_on_for_a_reader_who_shares() {
    let html = render_in_vdom(SharingHost);

    assert!(html.contains("Visible to your household"), "{html}");
    assert!(html.contains("checked"), "{html}");
    assert!(!html.contains("disabled"), "{html}");
    assert!(!html.contains("ld-unknown"), "{html}");
}

#[test]
fn share_stats_toggle_is_off_for_a_reader_who_keeps_their_stats_private() {
    let html = render_in_vdom(PrivateHost);

    assert!(!html.contains("checked"), "{html}");
    assert!(!html.contains("disabled"), "{html}");
}
