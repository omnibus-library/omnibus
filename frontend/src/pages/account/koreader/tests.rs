//! Tests for the KOReader card: which devices it lists, the labels a plugin row wears before
//! and after its first sync, and what SSR paints before the device list answers.

use omnibus_shared::{DeviceKind, KoboDeviceView};

use super::*;

fn device(kind: DeviceKind) -> KoboDeviceView {
    KoboDeviceView {
        id: 1,
        name: "Libra".to_string(),
        kind,
        token: "tok123".to_string(),
        created_at: 0,
        last_seen_at: 0,
        last_sync_at: None,
        last_sync_error: None,
        kosync_login: None,
    }
}

#[test]
fn koreader_devices_keeps_plugin_and_no_plugin_koreaders_and_drops_kobos() {
    let all = vec![
        device(DeviceKind::Kobo),
        device(DeviceKind::Koreader),
        device(DeviceKind::Kosync),
    ];

    let kept: Vec<_> = koreader_devices(all).into_iter().map(|d| d.kind).collect();

    assert_eq!(kept, [DeviceKind::Koreader, DeviceKind::Kosync]);
}

#[test]
fn koreader_setup_opens_by_default_until_the_reader_has_a_koreader() {
    assert!(koreader_setup_opens_by_default(&[]));
    assert!(!koreader_setup_opens_by_default(&[device(
        DeviceKind::Koreader
    )]));
    assert!(!koreader_setup_opens_by_default(&[device(
        DeviceKind::Kosync
    )]));
}

#[test]
fn plugin_download_url_names_the_device_and_ignores_a_trailing_slash() {
    assert_eq!(
        plugin_download_url("https://omni.example.com/", 7),
        "https://omni.example.com/api/account/kobo-devices/7/koreader-plugin"
    );
}

#[test]
fn added_label_says_just_now_for_a_device_added_within_the_minute() {
    assert_eq!(added_label(1_000, 1_059), "Added just now");
}

#[test]
fn added_label_names_the_date_once_the_minute_has_passed() {
    assert_eq!(
        added_label(1_704_067_200, 1_704_067_260),
        "Added Jan 1, 2024"
    );
}

#[test]
fn added_message_tells_a_plugin_koreaders_owner_to_download_its_plugin() {
    assert_eq!(
        added_message(&device(DeviceKind::Koreader)),
        "Added Libra. Download its plugin and put it on the device."
    );
}

#[test]
fn remove_confirm_text_names_the_koreader_being_removed() {
    let (title, body) = remove_confirm_text("Libra");

    assert_eq!(title, "Remove Libra?");
    assert!(
        body.starts_with("Libra stops syncing with Omnibus."),
        "{body}"
    );
}

// SSR render-smoke coverage. These need the `server` feature (`dioxus::ssr`).
#[cfg(feature = "server")]
mod render_tests {
    use dioxus_router::{Routable, Router};

    use super::*;
    use crate::test_support::render_in_vdom;

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum KoreaderRoute {
        #[route("/")]
        KoreaderHost {},
    }

    #[component]
    fn KoreaderHost() -> Element {
        rsx! { KoreaderDevicesCard {} }
    }

    /// The card links to `/shelves`, and a `Link` needs a router above it.
    fn card() -> Element {
        rsx! { Router::<KoreaderRoute> {} }
    }

    /// `Callback::new` needs a live runtime, so a row is built inside the throwaway `VirtualDom`.
    fn row_of(device: KoboDeviceView, can_download: bool) -> Element {
        rsx! {
            KoreaderDeviceRow {
                device,
                plugin_url: "https://omni.example.com/api/account/kobo-devices/1/koreader-plugin".to_string(),
                can_download,
                disabled: false,
                on_remove: Callback::new(|_| {}),
            }
        }
    }

    fn plugin_row(last_sync_at: Option<i64>, last_sync_error: Option<&str>) -> Element {
        row_of(
            KoboDeviceView {
                last_sync_at,
                last_sync_error: last_sync_error.map(str::to_string),
                ..device(DeviceKind::Koreader)
            },
            true,
        )
    }

    #[test]
    fn koreader_card_names_itself_and_offers_to_add_a_koreader() {
        let html = render_in_vdom(card);

        assert!(html.contains("<h3>KOReader</h3>"), "{html}");
        assert!(html.contains("Add a KOReader"), "{html}");
        assert!(!html.contains("Add a Kobo"), "{html}");
    }

    #[test]
    fn koreader_card_keeps_the_kobo_data_loss_warning_off_the_card() {
        let html = render_in_vdom(card);

        assert!(!html.contains("kobo-data-loss-warning"), "{html}");
    }

    #[test]
    fn koreader_card_is_loading_not_empty_before_the_list_answers() {
        let html = render_in_vdom(card);

        assert!(
            html.contains("data-testid=\"koreader-devices-loading\""),
            "{html}"
        );
        assert!(!html.contains("koreader-devices-empty"), "{html}");
    }

    #[test]
    fn koreader_card_keeps_the_setup_steps_in_a_closed_disclosure_before_the_list_answers() {
        let html = render_in_vdom(card);

        let start = html.find("<details").expect("a disclosure");
        let end = html.find("</details>").expect("the disclosure closes");
        let disclosure = &html[start..end];
        assert!(
            disclosure.contains("data-testid=\"koreader-setup\""),
            "{html}"
        );
        assert!(
            !disclosure.starts_with("<details open") && !disclosure.contains("open=true"),
            "{html}"
        );
        assert!(disclosure.contains("How to connect a KOReader"), "{html}");
    }

    #[test]
    fn koreader_card_names_the_plugins_folder_of_each_platform() {
        let html = render_in_vdom(card);

        for path in [".adds/koreader/plugins", "applications/koreader/plugins"] {
            assert!(html.contains(path), "{path}: {html}");
        }
        assert!(html.matches("koreader/plugins").count() >= 4, "{html}");
    }

    #[test]
    fn koreader_card_points_at_the_no_plugin_checkbox_from_its_last_step() {
        let html = render_in_vdom(card);
        let steps_end = html.find("</ol>").expect("the steps close");

        let last_step = &html[..steps_end];

        assert!(last_step.contains("Connect without the plugin"), "{html}");
        assert!(last_step.contains("Custom sync server"), "{html}");
    }

    #[test]
    fn koreader_card_states_the_shelf_rule_outside_the_numbered_steps_and_links_the_shelves() {
        let html = render_in_vdom(card);
        let steps_end = html.find("</ol>").expect("the steps close");

        let rule_at = html
            .find("data-testid=\"koreader-shelf-rule\"")
            .expect("the shelf rule renders");

        assert!(rule_at > steps_end, "{html}");
        assert!(html.contains(r#"href="/shelves""#), "{html}");
    }

    #[test]
    fn koreader_card_puts_the_name_field_and_add_button_in_one_row_above_the_status() {
        let html = render_in_vdom(card);
        let at = |needle: &str| {
            html.find(needle)
                .unwrap_or_else(|| panic!("missing {needle}: {html}"))
        };

        let row = at("class=\"device-add-row\"");
        let input = at("data-testid=\"koreader-device-name-input\"");
        let add = at("data-testid=\"koreader-device-add\"");
        let status = at("data-testid=\"koreader-devices-status\"");

        assert!(row < input && input < add && add < status, "{html}");
    }

    #[test]
    fn koreader_device_row_marks_an_unsynced_plugin_koreader_and_makes_download_primary() {
        let html = render_in_vdom(|| plugin_row(None, None));

        assert!(html.contains("Not synced yet"), "{html}");
        assert!(html.contains("Download plugin"), "{html}");
        assert!(!html.contains("Redownload plugin"), "{html}");
        let download = html
            .find("data-testid=\"koreader-plugin-download\"")
            .expect("the download link");
        let tag = &html[html[..download].rfind("<a ").unwrap()..download];
        assert!(tag.contains("btn primary"), "{html}");
    }

    #[test]
    fn koreader_device_row_says_it_was_just_added_before_its_first_sync() {
        let html = render_in_vdom(|| {
            row_of(
                KoboDeviceView {
                    created_at: crate::time::now_unix(),
                    ..device(DeviceKind::Koreader)
                },
                true,
            )
        });

        assert!(html.contains("Added just now"), "{html}");
    }

    #[test]
    fn koreader_device_row_offers_a_redownload_and_the_sync_date_once_synced() {
        let html = render_in_vdom(|| plugin_row(Some(1_704_067_200), None));

        assert!(html.contains("Redownload plugin"), "{html}");
        assert!(html.contains("Last sync Jan 1, 2024"), "{html}");
        assert!(!html.contains("Not synced yet"), "{html}");
        assert!(!html.contains("koreader-last-error"), "{html}");
    }

    #[test]
    fn koreader_device_row_tells_the_reader_to_redownload_the_plugin_after_a_failed_sync() {
        let html = render_in_vdom(|| {
            plugin_row(Some(1_704_067_200), Some("Couldn't download Alpha: 404"))
        });

        assert!(
            html.contains("Last sync failed: Couldn&#39;t download Alpha: 404"),
            "{html}"
        );
        assert!(html.contains("Redownload the plugin"), "{html}");
    }

    #[test]
    fn koreader_device_row_shows_no_device_token_and_no_regenerate() {
        let html = render_in_vdom(|| plugin_row(None, None));

        assert!(!html.contains("koreader-device-token"), "{html}");
        assert!(!html.contains("tok123"), "{html}");
        assert!(!html.contains("regenerate"), "{html}");
    }

    #[test]
    fn koreader_device_row_hides_the_download_from_a_reader_who_may_not_download() {
        let html = render_in_vdom(|| row_of(device(DeviceKind::Koreader), false));

        assert!(!html.contains("koreader-plugin-download"), "{html}");
        assert!(html.contains("Libra"), "{html}");
    }

    #[test]
    fn koreader_device_row_names_the_device_on_its_actions() {
        let html = render_in_vdom(|| plugin_row(None, None));

        assert!(
            html.contains(r#"aria-label="Download the plugin for Libra""#),
            "{html}"
        );
        assert!(html.contains(r#"aria-label="Remove Libra""#), "{html}");
        assert!(
            html.contains(
                r#"href="https://omni.example.com/api/account/kobo-devices/1/koreader-plugin""#
            ),
            "{html}"
        );
        assert!(
            html.contains(r#"download="omnibus-koreader-1.zip""#),
            "{html}"
        );
    }
}
