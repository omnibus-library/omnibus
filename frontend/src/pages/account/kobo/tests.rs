//! Tests for the sync devices card: setup steps, confirms and the device list.

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

fn device_of(kind: omnibus_shared::DeviceKind) -> KoboDeviceView {
    KoboDeviceView {
        id: 1,
        name: "Device".to_string(),
        kind,
        token: "tok".to_string(),
        created_at: 0,
        last_seen_at: 0,
    }
}

#[test]
fn setup_opens_by_default_when_the_reader_has_no_kobo() {
    use omnibus_shared::DeviceKind::{Kobo, Koreader};
    assert!(setup_opens_by_default(&[]));
    assert!(setup_opens_by_default(&[device_of(Koreader)]));
    assert!(!setup_opens_by_default(&[
        device_of(Koreader),
        device_of(Kobo)
    ]));
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

    use omnibus_shared::DeviceKind;

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

    fn device_row() -> Element {
        row_of(DeviceKind::Kobo, "Kobo Clara")
    }

    fn koreader_row() -> Element {
        row_of(DeviceKind::Koreader, "Libra")
    }

    /// `Callback::new` needs a live runtime, so the row is built inside the
    /// throwaway `VirtualDom` rather than via a bare `render`.
    fn row_of(kind: DeviceKind, name: &str) -> Element {
        rsx! {
            KoboDeviceRow {
                device: KoboDeviceView {
                    id: 1,
                    name: name.to_string(),
                    kind,
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
        assert!(html.contains("No devices registered yet."), "{html}");
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

    /// Read top to bottom: what this is, the hazard, how to connect, the form,
    /// then the devices, so a device added appears below the form, not above.
    #[test]
    fn kobo_card_orders_the_warning_setup_and_form_above_the_device_list() {
        let html = render_in_vdom(card);
        let at = |needle: &str| {
            html.find(needle)
                .unwrap_or_else(|| panic!("missing {needle}: {html}"))
        };
        let intro = at("Sync your shelves to a Kobo");
        let warning = at("data-testid=\"kobo-data-loss-warning\"");
        let setup = at("data-testid=\"kobo-setup\"");
        let form = at("id=\"kobo-add-form\"");
        let list = at("data-testid=\"kobo-devices-loading\"");
        assert!(
            intro < warning && warning < setup && setup < form && form < list,
            "{html}"
        );
    }

    /// The steps sit behind a disclosure that is closed until the device list
    /// answers, so SSR and the first paint agree on it.
    #[test]
    fn kobo_card_keeps_the_setup_steps_in_a_closed_disclosure_before_the_list_answers() {
        let html = render_in_vdom(card);
        let start = html.find("<details").expect("a disclosure");
        let end = html.find("</details>").expect("the disclosure closes");
        let disclosure = &html[start..end];
        assert!(disclosure.contains("data-testid=\"kobo-setup\""), "{html}");
        assert!(
            !disclosure.starts_with("<details open") && !disclosure.contains("open=true"),
            "{html}"
        );
        assert!(disclosure.contains("<summary"), "{html}");
        assert!(disclosure.contains("How to connect a Kobo"), "{html}");
        assert!(
            disclosure.contains("data-testid=\"kobo-setup-steps\""),
            "{html}"
        );
        assert!(
            disclosure.contains("data-testid=\"kobo-shelf-rule\""),
            "{html}"
        );
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum OpenSetupRoute {
        #[route("/")]
        OpenSetupHost {},
    }

    #[component]
    fn OpenSetupHost() -> Element {
        render_kobo_setup(true)
    }

    #[test]
    fn render_kobo_setup_opens_when_asked() {
        let html = render_in_vdom(|| rsx! { Router::<OpenSetupRoute> {} });
        assert!(html.contains("open=true"), "{html}");
    }

    /// kobo-backup both backs the device up and, through its TUI, sets the
    /// sync URL, so the warning and the steps both point at it.
    #[test]
    fn kobo_card_points_to_kobo_backup_from_the_warning_and_the_steps() {
        let html = render_in_vdom(card);
        let link = r#"href="https://github.com/omnibus-library/kobo-backup""#;
        let warning_end = html.find("data-testid=\"kobo-setup\"").expect("setup");
        assert!(html[..warning_end].contains(link), "warning: {html}");
        assert!(html[warning_end..].contains(link), "steps: {html}");
        assert!(html.contains("TUI"), "{html}");
    }

    #[test]
    fn kobo_card_makes_add_device_the_primary_action_in_the_form_footer() {
        let html = render_in_vdom(card);
        let footer = html
            .find("class=\"settings-actions\"")
            .expect("a footer row");
        let add = html.find("data-testid=\"kobo-device-add\"").expect("add");
        assert!(footer < add, "{html}");
        assert!(html[footer..add].contains("btn primary"), "{html}");
        assert!(
            html[footer..add].contains("data-testid=\"kobo-devices-status\""),
            "{html}"
        );
    }

    #[test]
    fn kobo_card_names_its_add_actions() {
        let html = render_in_vdom(card);
        assert!(html.contains("<h3>Sync devices</h3>"), "{html}");
        assert!(html.contains("Add a Kobo"), "{html}");
        assert!(html.contains("Add a KOReader"), "{html}");
    }

    #[test]
    fn kobo_card_keeps_the_kobo_add_as_the_form_submit_and_the_koreader_add_as_a_plain_button() {
        let html = render_in_vdom(card);
        let kobo = html
            .find("data-testid=\"kobo-device-add\"")
            .expect("kobo add");
        let koreader = html
            .find("data-testid=\"koreader-device-add\"")
            .expect("koreader add");
        let kobo_tag = &html[html[..kobo].rfind("<button").unwrap()..kobo];
        let koreader_tag = &html[html[..koreader].rfind("<button").unwrap()..koreader];
        assert!(kobo_tag.contains("type=\"submit\""), "{html}");
        assert!(koreader_tag.contains("type=\"button\""), "{html}");
    }

    #[test]
    fn kobo_device_row_shows_the_kind_badge() {
        let kobo = render_in_vdom(device_row);
        let koreader = render_in_vdom(koreader_row);
        for (html, label) in [(kobo, "Kobo"), (koreader, "KOReader")] {
            let badge = html
                .find("data-testid=\"device-kind-badge\"")
                .unwrap_or_else(|| panic!("no badge: {html}"));
            assert!(
                html[badge..].starts_with(&format!("data-testid=\"device-kind-badge\">{label}<")),
                "{html}"
            );
        }
    }

    #[test]
    fn kobo_device_row_shows_a_koreader_its_token_instead_of_an_endpoint() {
        let html = render_in_vdom(koreader_row);
        assert!(
            html.contains("data-testid=\"koreader-device-token\""),
            "{html}"
        );
        assert!(html.contains("value=\"tok123\""), "{html}");
        assert!(html.contains("Copy token"), "{html}");
        assert!(
            html.contains(r#"aria-label="Copy the device token for Libra""#),
            "{html}"
        );
        assert!(
            !html.contains("data-testid=\"kobo-endpoint-url\""),
            "{html}"
        );
        assert!(!html.contains("omni.example.com"), "{html}");
    }

    #[test]
    fn kobo_device_row_offers_a_koreader_no_regenerate() {
        let html = render_in_vdom(koreader_row);
        assert!(
            !html.contains("data-testid=\"kobo-device-regenerate\""),
            "{html}"
        );
        assert!(
            html.contains("data-testid=\"kobo-device-remove\""),
            "{html}"
        );
    }

    #[test]
    fn kobo_device_row_keeps_a_kobo_its_endpoint_and_regenerate() {
        let html = render_in_vdom(device_row);
        assert!(html.contains("data-testid=\"kobo-endpoint-url\""), "{html}");
        assert!(
            html.contains("data-testid=\"kobo-device-regenerate\""),
            "{html}"
        );
        assert!(
            !html.contains("data-testid=\"koreader-device-token\""),
            "{html}"
        );
    }
}
