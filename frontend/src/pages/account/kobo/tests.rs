//! Tests for the sync devices card: setup steps, confirms and the device list.

use super::*;
use crate::pages::account::test_support::device_view as device_of;

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
fn kobos_only_drops_koreaders_and_no_plugin_koreaders() {
    use omnibus_shared::DeviceKind::{Kobo, Koreader, Kosync};
    let all = vec![device_of(Koreader), device_of(Kobo), device_of(Kosync)];

    let kept: Vec<_> = kobos_only(all).into_iter().map(|d| d.kind).collect();

    assert_eq!(kept, [Kobo]);
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
        row_with(device_of_named("Kobo Clara"))
    }

    /// `Callback::new` needs a live runtime, so the row is built inside the
    /// throwaway `VirtualDom` rather than via a bare `render`.
    fn device_of_named(name: &str) -> KoboDeviceView {
        KoboDeviceView {
            name: name.to_string(),
            token: "tok123".to_string(),
            ..device_of(DeviceKind::Kobo)
        }
    }

    fn row_with(device: KoboDeviceView) -> Element {
        rsx! {
            KoboDeviceRow {
                device,
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
        assert!(html.contains("No Kobo registered yet."), "{html}");
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
        assert!(html.contains("Sync to my devices"));
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
        let intro = at("Sync your shelves, reading position and highlights to a Kobo");
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
    fn kobo_card_names_itself_and_offers_only_to_add_a_kobo() {
        let html = render_in_vdom(card);

        assert!(
            html.contains("<h3 id=\"kobo-card-title\">Kobo</h3>"),
            "{html}"
        );
        assert!(html.contains("Add a Kobo"), "{html}");
        assert!(!html.contains("Add a KOReader"), "{html}");
        assert!(!html.contains("koreader-device-add"), "{html}");
    }

    #[test]
    fn kobo_card_puts_the_name_field_and_add_button_in_one_row_above_the_status() {
        let html = render_in_vdom(card);
        let at = |needle: &str| {
            html.find(needle)
                .unwrap_or_else(|| panic!("missing {needle}: {html}"))
        };

        let row = at("class=\"device-add-row\"");
        let input = at("data-testid=\"kobo-device-name-input\"");
        let add = at("data-testid=\"kobo-device-add\"");
        let status = at("data-testid=\"kobo-devices-status\"");

        assert!(row < input && input < add && add < status, "{html}");
    }

    #[test]
    fn kobo_device_row_keeps_a_kobo_its_endpoint_and_regenerate_without_a_plugin() {
        let html = render_in_vdom(device_row);

        assert!(html.contains("data-testid=\"kobo-endpoint-url\""), "{html}");
        assert!(
            html.contains("data-testid=\"kobo-device-regenerate\""),
            "{html}"
        );
        assert!(!html.contains("koreader"), "{html}");
    }

    #[test]
    fn kobo_card_keeps_the_loading_skeleton_when_only_the_add_form_was_refused() {
        let html = render_in_vdom(|| render_pending_list(false));

        assert!(
            html.contains("data-testid=\"kobo-devices-loading\""),
            "{html}"
        );
        assert!(html.contains("Finding your Kobos"), "{html}");
    }

    #[test]
    fn kobo_card_draws_no_skeleton_once_the_list_failed_to_load() {
        let html = render_in_vdom(|| render_pending_list(true));

        assert!(!html.contains("kobo-devices-loading"), "{html}");
    }

    #[test]
    fn kobo_card_names_its_device_name_field_after_the_card() {
        let html = render_in_vdom(card);

        assert!(html.contains(r#"id="kobo-card-title""#), "{html}");
        assert!(
            html.contains(r#"aria-labelledby="kobo-card-title kobo-device-name-label""#),
            "{html}"
        );
    }

    #[test]
    fn kobo_card_disables_add_until_the_device_list_has_loaded() {
        let html = render_in_vdom(card);

        let add = html
            .find("data-testid=\"kobo-device-add\"")
            .expect("the add button");
        let tag = &html[html[..add].rfind("<button").unwrap()..add];
        assert!(tag.contains("disabled"), "{html}");
    }
}
