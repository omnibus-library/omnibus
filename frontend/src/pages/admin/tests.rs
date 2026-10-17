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
    rsx! { AdminPage { section: Some("people".to_string()), tab: None } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum LogsRoute {
    #[route("/")]
    LogsHost {},
}

#[component]
fn LogsHost() -> Element {
    provide_current_user(Some(Some(test_user(true, true))));
    rsx! { AdminPage { section: Some("health".to_string()), tab: Some("logs".to_string()) } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum ReaderRoute {
    #[route("/")]
    ReaderHost {},
}

#[component]
fn ReaderHost() -> Element {
    provide_current_user(Some(Some(test_user(false, true))));
    rsx! { AdminPage { section: Some("people".to_string()), tab: None } }
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum UnresolvedRoute {
    #[route("/")]
    UnresolvedHost {},
}

#[component]
fn UnresolvedHost() -> Element {
    provide_current_user(None);
    rsx! { AdminPage { section: Some("people".to_string()), tab: None } }
}

#[test]
fn admin_page_groups_its_sections_under_library_and_server() {
    let html = render_in_vdom(|| rsx! { Router::<PeopleRoute> {} });
    for slug in [
        "sources",
        "metadata",
        "cleanup",
        "people",
        "integrations",
        "health",
    ] {
        assert!(
            html.contains(&format!("admin-nav-{slug}")),
            "{slug}: {html}"
        );
    }
    let library = html.find(">Library<").expect("Library group");
    let server = html.find(">Server<").expect("Server group");
    assert!(library < html.find("admin-nav-sources").unwrap());
    assert!(server < html.find("admin-nav-people").unwrap());
    assert!(library < server, "{html}");
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
fn admin_page_opens_a_health_tab_and_marks_it_current() {
    let html = render_in_vdom(|| rsx! { Router::<LogsRoute> {} });
    for tab in ["overview", "activity", "maintenance", "logs"] {
        assert!(html.contains(&format!("health-tab-{tab}")), "{tab}: {html}");
    }
    assert!(
        html.contains(r#"data-testid="health-tab-logs" aria-current="page""#),
        "{html}"
    );
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
