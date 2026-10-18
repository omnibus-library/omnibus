use super::*;

#[test]
fn endpoint_url_joins_origin_and_token() {
    assert_eq!(
        endpoint_url("https://omni.example.com", "tok123"),
        "https://omni.example.com/kobo/tok123"
    );
}

#[test]
fn endpoint_url_trims_a_trailing_slash_on_the_origin() {
    assert_eq!(
        endpoint_url("http://localhost:3000/", "abc"),
        "http://localhost:3000/kobo/abc"
    );
}

#[test]
fn kobo_confirm_text_warns_that_regenerating_breaks_sync_until_the_device_is_updated() {
    let (title, body) = kobo_confirm_text(KoboAction::Regenerate, "Kobo Clara");
    assert_eq!(title, "Regenerate the token for Kobo Clara?");
    assert!(body.contains("stops syncing"), "{body}");
    assert!(body.contains("api_endpoint"), "{body}");
}

#[test]
fn kobo_confirm_text_names_the_device_being_removed() {
    let (title, body) = kobo_confirm_text(KoboAction::Remove, "Kobo Clara");
    assert_eq!(title, "Remove Kobo Clara?");
    assert!(body.contains("stops syncing"), "{body}");
}

// SSR render-smoke coverage. These need the `server` feature (`dioxus::ssr`).
#[cfg(feature = "server")]
mod render_tests {
    use dioxus_router::{Routable, Router};

    use super::*;
    use crate::test_support::render_in_vdom;

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum KoboRoute {
        #[route("/")]
        KoboHost {},
    }

    #[component]
    fn KoboHost() -> Element {
        rsx! { KoboDevicesCard {} }
    }

    /// The card links to `/shelves`, and a `Link` needs a router above it.
    fn card() -> Element {
        rsx! { Router::<KoboRoute> {} }
    }

    /// `Callback::new` needs a live runtime, so the row is built inside the
    /// throwaway `VirtualDom` rather than via a bare `render`.
    fn device_row() -> Element {
        rsx! {
            KoboDeviceRow {
                device: KoboDeviceView {
                    id: 1,
                    name: "Kobo Clara".to_string(),
                    token: "tok123".to_string(),
                    created_at: 0,
                    last_seen_at: 0,
                },
                endpoint: "https://omni.example.com/kobo/tok123".to_string(),
                disabled: false,
                on_regenerate: Callback::new(|_| {}),
                on_remove: Callback::new(|_| {}),
            }
        }
    }

    /// The warning sits at card level, above the list, so it is present on the
    /// very first paint — before any device row (and therefore any endpoint
    /// URL) can render. `KoboDeviceRow` is only ever mounted inside this card,
    /// so covering the card covers every path that shows a URL (#927 AC1/AC4).
    #[test]
    fn kobo_card_renders_the_data_loss_warning_on_first_paint() {
        let html = render_in_vdom(card);
        assert!(html.contains("data-testid=\"kobo-data-loss-warning\""));
        assert!(html.contains("First sync can erase your Kobo\u{2019}s highlights"));
        assert!(html.contains("KoboReader.sqlite"));
    }

    /// The setup steps must name the real procedure — the USB edit of
    /// `Kobo eReader.conf` — and never a nonexistent on-device setting
    /// (the pre-#1499 copy pointed at "Settings → Beta Features").
    #[test]
    fn kobo_card_walks_through_the_conf_file_setup() {
        let html = render_in_vdom(card);
        assert!(html.contains("data-testid=\"kobo-setup-steps\""));
        assert!(html.contains("Kobo eReader.conf"));
        assert!(html.contains("api_endpoint="));
        assert!(!html.contains("Beta Features"));
    }

    /// The warning must not be gated on having registered a device — a user
    /// reads it *before* adding their first Kobo, not after. First paint hasn't
    /// heard back yet, so the list is loading rather than claiming none.
    #[test]
    fn kobo_card_warns_before_the_device_list_has_answered() {
        let html = render_in_vdom(card);
        assert!(
            html.contains("data-testid=\"kobo-devices-loading\""),
            "{html}"
        );
        assert!(!html.contains("data-testid=\"kobo-devices-empty\""));
        assert!(html.contains("data-testid=\"kobo-data-loss-warning\""));
    }

    fn empty_device_list() -> Element {
        render_kobo_device_list(&[], "", false, Callback::new(|_| {}), Callback::new(|_| {}))
    }

    #[test]
    fn render_kobo_device_list_says_none_registered_once_the_list_is_empty() {
        let html = render_in_vdom(empty_device_list);
        assert!(
            html.contains("data-testid=\"kobo-devices-empty\""),
            "{html}"
        );
    }

    /// The row is what actually exposes the endpoint URL; assert it renders so
    /// the card-level warning test above is anchored to a real URL surface.
    #[test]
    fn kobo_device_row_renders_the_endpoint_url() {
        let html = render_in_vdom(device_row);
        assert!(html.contains("https://omni.example.com/kobo/tok123"));
    }

    /// The standing "only flagged shelves sync" rule is a constraint, not a
    /// step — a reader working the numbered list has nothing to *do* at that
    /// number (#2511 AC2).
    #[test]
    fn kobo_card_states_the_shelf_rule_outside_the_numbered_steps() {
        let html = render_in_vdom(card);
        let ol_end = html.find("</ol>").expect("the setup list closes");
        let rule_at = html
            .find("data-testid=\"kobo-shelf-rule\"")
            .expect("the standing shelf rule renders");
        assert!(
            rule_at > ol_end,
            "the shelf rule must sit after the procedure list, not inside it"
        );
        assert!(html.contains("Sync to Kobo"));
    }

    /// Step 2 and step 4 must name the same thing: the whole URL the field
    /// below shows. The old copy pointed step 2 at a bare path and step 4 at a
    /// placeholder origin, so a reader could follow both and still write an
    /// unresolvable `api_endpoint=` (#2511 AC1).
    #[test]
    fn kobo_card_steps_name_the_endpoint_the_field_shows() {
        let html = render_in_vdom(card);
        assert!(html.contains("api_endpoint="));
        assert!(!html.contains("your_omnibus_server_url"));
        assert!(!html.contains("/kobo/&lt;token&gt;"));
    }

    #[test]
    fn kobo_device_row_names_the_device_on_its_actions() {
        let html = render_in_vdom(device_row);
        assert!(
            html.contains(r#"aria-label="Regenerate token for Kobo Clara""#),
            "{html}"
        );
        assert!(html.contains(r#"aria-label="Remove Kobo Clara""#), "{html}");
    }

    #[test]
    fn kobo_device_row_offers_a_copy_of_the_endpoint_url() {
        let html = render_in_vdom(device_row);
        assert!(html.contains(r#"translate="no""#), "{html}");
        assert!(
            html.contains(r#"data-testid="kobo-endpoint-copy""#),
            "{html}"
        );
    }

    #[test]
    fn kobo_card_links_to_the_shelves_it_syncs() {
        let html = render_in_vdom(card);
        assert!(html.contains(r#"href="/shelves""#), "{html}");
        assert!(html.contains("Choose shelves to sync"), "{html}");
    }

    #[test]
    fn kobo_card_names_its_add_action() {
        let html = render_in_vdom(card);
        assert!(html.contains("<h3>Kobo wireless sync</h3>"), "{html}");
        assert!(html.contains("Add device"), "{html}");
    }
}
