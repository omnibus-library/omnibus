use dioxus::prelude::*;
use dioxus_router::{Routable, Router};

use super::*;
use crate::test_support::{provide_current_user, render_in_vdom, test_user};

#[derive(Clone, Debug, PartialEq, Routable)]
enum PeopleRoute {
    #[route("/")]
    PeopleHost {},
}

#[component]
fn PeopleHost() -> Element {
    provide_current_user(Some(Some(test_user(true, true))));
    rsx! { AdminPage { section: Some("people".to_string()) } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum MaintenanceRoute {
    #[route("/")]
    MaintenanceHost {},
}

#[component]
fn MaintenanceHost() -> Element {
    provide_current_user(Some(Some(test_user(true, true))));
    rsx! { AdminPage { section: Some("maintenance".to_string()) } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum ReaderRoute {
    #[route("/")]
    ReaderHost {},
}

#[component]
fn ReaderHost() -> Element {
    provide_current_user(Some(Some(test_user(false, true))));
    rsx! { AdminPage { section: Some("people".to_string()) } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum BareReaderRoute {
    #[route("/")]
    BareReaderHost {},
}

#[component]
fn BareReaderHost() -> Element {
    provide_current_user(Some(Some(test_user(false, true))));
    rsx! { AdminPage { section: None } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum UnresolvedRoute {
    #[route("/")]
    UnresolvedHost {},
}

#[component]
fn UnresolvedHost() -> Element {
    provide_current_user(None);
    rsx! { AdminPage { section: Some("people".to_string()) } }
}

#[test]
fn admin_page_groups_its_sections_under_library_and_server() {
    let html = render_in_vdom(|| rsx! { Router::<PeopleRoute> {} });
    let position = |slug: &str| {
        html.find(&format!("admin-nav-{slug}"))
            .unwrap_or_else(|| panic!("{slug}: {html}"))
    };
    let library = html.find(">Library<").expect("Library group");
    let server = html.find(">Server<").expect("Server group");
    for slug in ["sources", "maintenance", "metadata", "cleanup"] {
        assert!(
            library < position(slug) && position(slug) < server,
            "{slug}"
        );
    }
    for slug in ["people", "integrations", "health", "logs"] {
        assert!(server < position(slug), "{slug}");
    }
}

#[test]
fn admin_page_shows_no_line_under_the_section_heading() {
    let html = render_in_vdom(|| rsx! { Router::<PeopleRoute> {} });
    assert!(!html.contains("settings-section-desc"), "{html}");
}

#[test]
fn admin_page_opens_the_named_section() {
    let html = render_in_vdom(|| rsx! { Router::<PeopleRoute> {} });
    assert!(
        html.contains(r#"data-testid="admin-nav-people" aria-current="page""#),
        "{html}"
    );
    assert!(html.contains("users-card"), "{html}");
}

#[test]
fn admin_page_links_back_to_personal_settings() {
    let html = render_in_vdom(|| rsx! { Router::<PeopleRoute> {} });
    assert!(html.contains("admin-nav-settings"), "{html}");
    assert!(html.contains(r#"href="/settings""#), "{html}");
}

#[test]
fn admin_page_puts_recent_tasks_under_the_maintenance_commands() {
    let html = render_in_vdom(|| rsx! { Router::<MaintenanceRoute> {} });
    let commands = html.find("maintenance-card").expect("commands");
    let tasks = html.find("background-tasks-card").expect("recent tasks");
    assert!(commands < tasks, "{html}");
    assert!(!html.contains("settings-tabs"), "{html}");
}

#[test]
fn admin_page_refuses_a_reader_who_is_not_an_admin() {
    let html = render_in_vdom(|| rsx! { Router::<ReaderRoute> {} });
    assert!(html.contains("admin-forbidden"), "{html}");
    assert!(!html.contains("users-card"), "{html}");
}

#[test]
fn admin_page_waits_while_the_reader_is_unresolved() {
    let html = render_in_vdom(|| rsx! { Router::<UnresolvedRoute> {} });
    assert!(html.contains("admin-loading"), "{html}");
    assert!(!html.contains("admin-forbidden"), "{html}");
    assert!(!html.contains("users-card"), "{html}");
}

#[test]
fn admin_page_sets_the_way_back_to_settings_apart() {
    let html = render_in_vdom(|| rsx! { Router::<PeopleRoute> {} });
    let divided = html
        .find(r#"class="settings-nav-group divided""#)
        .expect("a divided group");
    assert!(divided < html.find("admin-nav-settings").unwrap(), "{html}");
    assert!(html.find("admin-nav-logs").unwrap() < divided, "{html}");
}

#[test]
fn admin_page_shows_a_reader_the_refusal_rather_than_the_section_list_on_narrow_screens() {
    let html = render_in_vdom(|| rsx! { Router::<BareReaderRoute> {} });
    assert!(html.contains("admin-forbidden"), "{html}");
    assert!(
        html.contains(r#"class="settings-layout has-section""#),
        "{html}"
    );
}
