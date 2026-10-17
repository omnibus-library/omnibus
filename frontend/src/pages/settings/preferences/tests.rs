use super::*;
use crate::components::atrium::init_theme;
use crate::test_support::{provide_current_user, render_in_vdom, test_user};

fn unresolved() -> Element {
    init_theme();
    provide_current_user(None);
    rsx! { PreferencesSection {} }
}

fn resolved() -> Element {
    init_theme();
    let mut reader = test_user(false, false);
    reader.share_stats = true;
    reader.stack_series = false;
    reader.hidden_formats = vec!["cbz".to_string()];
    provide_current_user(Some(Some(reader)));
    rsx! { PreferencesSection {} }
}

#[test]
fn preferences_section_groups_its_settings_under_four_headings_in_order() {
    let html = render_in_vdom(resolved);
    let at = |heading: &str| {
        html.find(&format!("<h3>{heading}</h3>"))
            .unwrap_or_else(|| panic!("{heading}: {html}"))
    };
    assert!(at("Appearance") < at("Library"), "{html}");
    assert!(at("Library") < at("Book page"), "{html}");
    assert!(at("Book page") < at("Privacy"), "{html}");
}

#[test]
fn preferences_section_scopes_the_theme_to_this_device() {
    let html = render_in_vdom(resolved);
    assert!(html.contains("Applies to this device."), "{html}");
    assert!(html.contains(r#"data-testid="theme-sepia""#), "{html}");
}

#[test]
fn preferences_section_waits_on_every_control_until_the_viewer_resolves() {
    let html = render_in_vdom(unresolved);
    for slug in ["stack-series", "scroll-stops", "share-stats"] {
        assert!(
            html.contains(&format!(r#"data-testid="{slug}-toggle""#)),
            "{slug}: {html}"
        );
    }
    assert_eq!(html.matches("ld-unknown").count(), 3, "{html}");
    assert!(html.contains("hidden-formats-loading"), "{html}");
    assert!(!html.contains("hidden-format-toggle-"), "{html}");
}

#[test]
fn preferences_section_shows_the_resolved_readers_choices() {
    let html = render_in_vdom(resolved);
    assert!(!html.contains("ld-unknown"), "{html}");
    let checked = |testid: &str| {
        let at = html
            .find(&format!(r#"data-testid="{testid}""#))
            .unwrap_or_else(|| panic!("{testid}: {html}"));
        let end = at + html[at..].find('>').unwrap_or(0);
        html[at..end].contains("checked")
    };
    assert!(checked("share-stats-toggle"), "{html}");
    assert!(!checked("stack-series-toggle"), "{html}");
    assert!(checked("hidden-format-toggle-cbz"), "{html}");
    assert!(!checked("hidden-format-toggle-epub"), "{html}");
}

#[test]
fn preferences_section_labels_hidden_formats_as_one_group() {
    let html = render_in_vdom(resolved);
    assert!(html.contains("<legend"), "{html}");
    assert!(html.contains("Hidden formats</legend>"), "{html}");
    assert!(html.contains(">EPUB<"), "{html}");
    assert!(!html.contains("hidden-formats-save"), "{html}");
}

#[test]
fn preferences_section_says_sharing_stats_is_on_by_default() {
    let html = render_in_vdom(resolved);
    assert!(html.contains("On by default."), "{html}");
}
