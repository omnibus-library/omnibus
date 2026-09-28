//! Tests for each `UserSetting`'s status line, plus the settings card's SSR
//! render while the viewer is still unresolved.

use super::*;

#[test]
fn user_setting_status_line_describes_scroll_stops() {
    assert_eq!(
        UserSetting::ScrollStops.status_line(None),
        "Checking\u{2026}"
    );
    assert_eq!(
        UserSetting::ScrollStops.status_line(Some(true)),
        "Book details snap through one panel at a time."
    );
    assert_eq!(
        UserSetting::ScrollStops.status_line(Some(false)),
        "Book details scroll continuously, top to bottom."
    );
}

#[test]
fn user_setting_status_line_describes_share_stats() {
    assert_eq!(
        UserSetting::ShareStats.status_line(None),
        "Checking\u{2026}"
    );
    assert_eq!(
        UserSetting::ShareStats.status_line(Some(true)),
        "Other readers on this server can see your stats page."
    );
    assert_eq!(
        UserSetting::ShareStats.status_line(Some(false)),
        "Only you can see your stats page."
    );
}

// `test_support`'s SSR renderer only exists on the `server` feature.
#[cfg(feature = "server")]
fn unresolved() -> Element {
    crate::test_support::provide_current_user(None);
    rsx! { UserSettingsCard {} }
}

#[cfg(feature = "server")]
#[test]
fn user_settings_card_renders_every_switch_unknown_until_the_viewer_resolves() {
    let html = crate::test_support::render_in_vdom(unresolved);
    assert!(html.contains("scroll-stops-toggle"), "{html}");
    assert!(html.contains("share-stats-toggle"), "{html}");
    assert_eq!(html.matches("disabled").count(), 2, "{html}");
    assert_eq!(html.matches("ld-unknown").count(), 2, "{html}");
    assert!(html.contains("Checking\u{2026}"), "{html}");
    assert!(html.contains("ld-sheen"), "{html}");
}
