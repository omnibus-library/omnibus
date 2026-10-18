use dioxus_router::{Routable, Router};

use super::*;
use crate::test_support::{provide_current_user, render_in_vdom, test_user};

#[derive(Clone, Debug, PartialEq, Routable)]
enum DevicesRoute {
    #[route("/")]
    DevicesHost {},
}

#[component]
fn DevicesHost() -> Element {
    provide_current_user(Some(Some(test_user(false, false))));
    rsx! { SettingsPage { section: Some("devices".to_string()) } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum AdminReaderRoute {
    #[route("/")]
    AdminReaderHost {},
}

#[component]
fn AdminReaderHost() -> Element {
    provide_current_user(Some(Some(test_user(true, true))));
    rsx! { SettingsPage { section: None } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum LegacyRoute {
    #[route("/")]
    LegacyHost {},
}

#[component]
fn LegacyHost() -> Element {
    provide_current_user(Some(Some(test_user(true, true))));
    rsx! { SettingsPage { section: Some("library".to_string()) } }
}

#[test]
fn settings_page_lists_the_five_personal_sections() {
    let html = render_in_vdom(|| rsx! { Router::<DevicesRoute> {} });
    for (slug, label) in [
        ("profile", "Profile"),
        ("preferences", "Preferences"),
        ("goals", "Goals"),
        ("devices", "Devices"),
        ("security", "Sign-in &#38; security"),
    ] {
        assert!(
            html.contains(&format!("settings-nav-{slug}")),
            "{slug}: {html}"
        );
        assert!(html.contains(label), "{label}: {html}");
    }
    assert!(!html.contains("settings-nav-library"), "{html}");
}

#[test]
fn settings_page_marks_the_open_section_current() {
    let html = render_in_vdom(|| rsx! { Router::<DevicesRoute> {} });
    assert!(
        html.contains(r#"data-testid="settings-nav-devices" aria-current="page""#),
        "{html}"
    );
    assert!(html.contains("account-kindle-card"), "{html}");
    assert!(html.contains("kobo-devices-card"), "{html}");
}

#[test]
fn settings_page_reads_as_a_page_on_narrow_screens_once_a_section_is_named() {
    let named = render_in_vdom(|| rsx! { Router::<DevicesRoute> {} });
    assert!(named.contains("settings-layout has-section"), "{named}");
    let bare = render_in_vdom(|| rsx! { Router::<AdminReaderRoute> {} });
    assert!(!bare.contains("has-section"), "{bare}");
}

#[test]
fn settings_page_hides_the_administration_link_from_readers() {
    let html = render_in_vdom(|| rsx! { Router::<DevicesRoute> {} });
    assert!(!html.contains("settings-nav-admin"), "{html}");
}

#[test]
fn settings_page_links_admins_to_administration() {
    let html = render_in_vdom(|| rsx! { Router::<AdminReaderRoute> {} });
    assert!(html.contains("settings-nav-admin"), "{html}");
    assert!(html.contains(r#"href="/admin""#), "{html}");
}

#[test]
fn settings_page_waits_on_a_legacy_slug_instead_of_rendering_a_section() {
    let html = render_in_vdom(|| rsx! { Router::<LegacyRoute> {} });
    assert!(html.contains("settings-redirecting"), "{html}");
    assert!(!html.contains("settings-layout"), "{html}");
}

#[test]
fn settings_page_sets_the_administration_link_apart() {
    let html = render_in_vdom(|| rsx! { Router::<AdminReaderRoute> {} });
    let divided = html
        .find(r#"class="settings-nav-group divided""#)
        .expect("a divided group");
    assert!(divided < html.find("settings-nav-admin").unwrap(), "{html}");
}
