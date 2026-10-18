use dioxus_router::{Routable, Router};
use omnibus_shared::KindleDelivery;

use super::*;
use crate::test_support::{provide_current_user, render, render_in_vdom, test_user};
use crate::Access;

fn ready() -> Option<Option<KindleDelivery>> {
    Some(Some(KindleDelivery::for_sender(Some(
        "library@example.com".to_string(),
    ))))
}

fn not_set_up() -> Option<Option<KindleDelivery>> {
    Some(Some(KindleDelivery::for_sender(None)))
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum AdminLineRoute {
    #[route("/")]
    AdminLineHost {},
}

#[component]
fn AdminLineHost() -> Element {
    kindle_delivery_line(not_set_up(), Access::Allowed)
}

#[derive(Clone, Debug, PartialEq, Routable)]
enum CardRoute {
    #[route("/")]
    CardHost {},
}

#[component]
fn CardHost() -> Element {
    provide_current_user(Some(Some(test_user(false, false))));
    rsx! { KindleEmailCard {} }
}

#[test]
fn kindle_line_checks_before_claiming_no_address_is_configured() {
    let pending = render(kindle_connected_line(false, None));
    assert!(pending.contains("ld-sheen"), "{pending}");
    assert!(
        !pending.contains("No Kindle email configured yet."),
        "{pending}"
    );
    let answered = render(kindle_connected_line(false, Some(true)));
    assert!(
        answered.contains("No Kindle email configured yet."),
        "{answered}"
    );
    let failed = render(kindle_connected_line(false, Some(false)));
    assert!(
        !failed.contains("No Kindle email configured yet."),
        "{failed}"
    );
}

#[test]
fn kindle_delivery_line_waits_while_the_server_is_asked() {
    let html = render_in_vdom(|| kindle_delivery_line(None, Access::Denied));
    assert!(html.contains("kindle-delivery-loading"), "{html}");
    assert!(!html.contains("isn\u{2019}t set up"), "{html}");
}

#[test]
fn kindle_delivery_line_names_the_sender_to_approve_when_delivery_is_ready() {
    let html = render_in_vdom(|| kindle_delivery_line(ready(), Access::Denied));
    assert!(html.contains("Approve"), "{html}");
    assert!(html.contains("library@example.com"), "{html}");
    assert!(html.contains("approved senders"), "{html}");
    assert!(
        html.contains(r#"data-testid="kindle-sender-copy""#),
        "{html}"
    );
}

#[test]
fn kindle_delivery_line_sends_a_reader_to_their_administrator_when_not_set_up() {
    let html = render_in_vdom(|| kindle_delivery_line(not_set_up(), Access::Denied));
    assert!(
        html.contains(
            "Email delivery isn\u{2019}t set up on this server \u{2014} ask your administrator."
        ),
        "{html}"
    );
}

#[test]
fn kindle_delivery_line_links_an_admin_to_integrations_when_not_set_up() {
    let html = render_in_vdom(|| rsx! { Router::<AdminLineRoute> {} });
    assert!(
        html.contains(r#"href="/admin?section=integrations""#),
        "{html}"
    );
    assert!(!html.contains("ask your administrator"), "{html}");
}

#[test]
fn kindle_delivery_line_waits_for_the_readers_role_before_naming_who_sets_it_up() {
    let html = render_in_vdom(|| kindle_delivery_line(not_set_up(), Access::Unknown));
    assert!(html.contains("kindle-delivery-loading"), "{html}");
}

#[test]
fn kindle_card_names_its_save_action() {
    let html = render_in_vdom(|| rsx! { Router::<CardRoute> {} });
    assert!(html.contains("<h3>Kindle</h3>"), "{html}");
    assert!(html.contains("Save Kindle email"), "{html}");
    assert!(html.contains("kindle-delivery-loading"), "{html}");
}
