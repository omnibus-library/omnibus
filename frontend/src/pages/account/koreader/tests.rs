//! Tests for the KOReader card: which devices it lists, the labels a plugin row wears before
//! and after its first sync, and what SSR paints before the device list answers.

use omnibus_shared::{DeviceKind, KoboDeviceView, KosyncPassword};

use super::*;
use crate::pages::account::test_support::device_view as device;

fn login() -> KosyncPassword {
    KosyncPassword {
        username: "ada".to_string(),
        password: "abcde-fghjk-mnpqr-stuvw".to_string(),
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
fn added_message_asks_for_the_login_to_be_copied_when_a_no_plugin_koreader_made_it() {
    let added = KoboDeviceView {
        kosync_login: Some(login()),
        ..device(DeviceKind::Kosync)
    };

    assert_eq!(
        added_message(&added),
        "Added Libra. Copy its login now: the password is shown once."
    );
}

#[test]
fn added_message_is_plain_when_a_no_plugin_koreader_reuses_the_login() {
    assert_eq!(added_message(&device(DeviceKind::Kosync)), "Added Libra.");
}

#[test]
fn kosync_url_joins_the_origin_and_the_kosync_path() {
    assert_eq!(
        kosync_url("https://omni.example.com"),
        "https://omni.example.com/kosync"
    );
}

#[test]
fn kosync_url_has_no_trailing_slash_even_when_the_origin_does() {
    assert_eq!(
        kosync_url("http://localhost:3000/"),
        "http://localhost:3000/kosync"
    );
}

#[test]
fn join_names_reads_as_a_list() {
    let names = |n: &[&str]| n.iter().map(|s| s.to_string()).collect::<Vec<_>>();

    assert_eq!(join_names(&names(&["Libra"])), "Libra");
    assert_eq!(join_names(&names(&["Libra", "Clara"])), "Libra and Clara");
    assert_eq!(
        join_names(&names(&["Libra", "Clara", "Sage"])),
        "Libra, Clara and Sage"
    );
}

#[test]
fn generate_confirm_text_names_the_one_koreader_it_signs_out() {
    let (title, body) = generate_confirm_text(&["Libra".to_string()]);

    assert_eq!(title, "Generate a new Progress sync password?");
    assert_eq!(
        body,
        "Libra stops syncing its place until you log in on it again with the new password. \
         Every no-plugin KOReader shares this one login. Plugin KOReaders and Kobos \
         aren\u{2019}t affected."
    );
}

#[test]
fn generate_confirm_text_names_every_koreader_it_signs_out() {
    let (_, body) = generate_confirm_text(&["Libra".to_string(), "Clara".to_string()]);

    assert!(
        body.starts_with("Libra and Clara stop syncing their place until you log in on them again"),
        "{body}"
    );
}

#[test]
fn remove_confirm_text_names_the_plugin_koreader_being_removed() {
    let (title, body) = remove_confirm_text("Libra", Removal::Plugin);

    assert_eq!(title, "Remove Libra?");
    assert_eq!(
        body,
        "Libra stops syncing with Omnibus. To sync it again, add it as a new device."
    );
}

#[test]
fn remove_confirm_text_says_a_no_plugin_koreader_keeps_syncing_until_the_password_changes() {
    let (title, body) = remove_confirm_text("Libra", Removal::NoPlugin);

    assert_eq!(title, "Remove Libra?");
    assert_eq!(
        body,
        "Libra is removed from this list, but it can still sync its place until you generate a \
         new password: every no-plugin KOReader shares one login."
    );
}

#[test]
fn remove_confirm_text_says_the_progress_sync_login_goes_with_the_last_no_plugin_koreader() {
    let (title, body) = remove_confirm_text("Libra", Removal::LastNoPlugin);

    assert_eq!(title, "Remove Libra?");
    assert_eq!(
        body,
        "Libra stops syncing with Omnibus. It\u{2019}s your last no-plugin KOReader, so this \
         also turns off Progress sync: its password stops working."
    );
}

#[test]
fn removal_of_tells_a_plugin_a_shared_and_a_last_no_plugin_koreader_apart() {
    let list = |kinds: &[DeviceKind]| -> Vec<KoboDeviceView> {
        kinds
            .iter()
            .enumerate()
            .map(|(i, kind)| KoboDeviceView {
                id: i as i64 + 1,
                ..device(*kind)
            })
            .collect()
    };

    let only = list(&[DeviceKind::Koreader, DeviceKind::Kosync]);
    let two = list(&[DeviceKind::Kosync, DeviceKind::Kosync]);

    assert_eq!(removal_of(&only, 2), Removal::LastNoPlugin);
    assert_eq!(removal_of(&two, 2), Removal::NoPlugin);
    assert_eq!(removal_of(&only, 1), Removal::Plugin);
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
                on_generate: Callback::new(|_| {}),
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

        assert!(
            html.contains("<h3 id=\"koreader-card-title\">KOReader</h3>"),
            "{html}"
        );
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
            html.contains(r#"aria-label="Download plugin for Libra""#),
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

    fn no_plugin_row(sync: ProgressSync) -> Element {
        rsx! {
            KoreaderDeviceRow {
                device: device(DeviceKind::Kosync),
                plugin_url: "https://omni.example.com/api/account/kobo-devices/1/koreader-plugin".to_string(),
                can_download: true,
                disabled: false,
                on_remove: Callback::new(|_| {}),
                on_generate: Callback::new(|_| {}),
                sync,
            }
        }
    }

    fn sync_of(panel: Option<RowPanel>) -> ProgressSync {
        ProgressSync {
            panel,
            server_url: "https://omni.example.com/kosync".to_string(),
            username: "ada".to_string(),
            all_names: "Libra and Clara".to_string(),
            ..ProgressSync::default()
        }
    }

    #[test]
    fn koreader_card_offers_the_no_plugin_checkbox_unticked_between_the_name_row_and_the_status() {
        let html = render_in_vdom(card);
        let at = |needle: &str| {
            html.find(needle)
                .unwrap_or_else(|| panic!("missing {needle}: {html}"))
        };

        let add = at("data-testid=\"koreader-device-add\"");
        let checkbox = at("data-testid=\"koreader-no-plugin\"");
        let status = at("data-testid=\"koreader-devices-status\"");

        assert!(add < checkbox && checkbox < status, "{html}");
        let tag = &html[html[..checkbox].rfind("<input").unwrap()..checkbox];
        assert!(tag.contains("type=\"checkbox\""), "{html}");
        assert!(!tag.contains("checked"), "{html}");
        assert!(
            html.contains("Connect without the plugin (Progress sync only)"),
            "{html}"
        );
        assert!(
            html.contains("It uses KOReader\u{2019}s built-in Progress sync, which keeps only your place in step: no shelves, no highlights."),
            "{html}"
        );
    }

    #[test]
    fn koreader_device_row_marks_a_no_plugin_koreader_and_offers_no_plugin_download() {
        let html = render_in_vdom(|| no_plugin_row(sync_of(None)));

        assert!(html.contains("No plugin"), "{html}");
        assert!(html.contains("Progress sync"), "{html}");
        assert!(!html.contains("koreader-plugin-download"), "{html}");
        assert!(!html.contains("Not synced yet"), "{html}");
        assert!(!html.contains("koreader-last-sync"), "{html}");
    }

    #[test]
    fn koreader_device_row_shows_a_fresh_login_once_with_a_copy_button_per_field() {
        let html = render_in_vdom(|| no_plugin_row(sync_of(Some(RowPanel::Fresh(login())))));

        assert!(html.contains("Progress sync login (shown once)"), "{html}");
        for (testid, value) in [
            ("kosync-url", "https://omni.example.com/kosync"),
            ("kosync-username", "ada"),
            ("kosync-password", "abcde-fghjk-mnpqr-stuvw"),
        ] {
            assert!(
                html.contains(&format!("data-testid=\"{testid}\"")),
                "{testid}: {html}"
            );
            assert!(
                html.contains(&format!("value=\"{value}\"")),
                "{value}: {html}"
            );
            assert!(
                html.contains(&format!("data-testid=\"{testid}-copy\"")),
                "{testid}: {html}"
            );
        }
        assert!(
            html.contains("Every no-plugin KOReader shares this one login. Only books downloaded from Omnibus match."),
            "{html}"
        );
    }

    #[test]
    fn koreader_device_row_ids_its_login_fields_by_device_so_two_rows_never_share_one() {
        let html = render_in_vdom(|| no_plugin_row(sync_of(Some(RowPanel::Fresh(login())))));

        assert!(html.contains("id=\"kosync-password-1\""), "{html}");
    }

    #[test]
    fn koreader_device_row_says_it_reuses_the_login_without_naming_another_device() {
        let html = render_in_vdom(|| no_plugin_row(sync_of(Some(RowPanel::Reuse))));

        assert!(
            html.contains("Uses your existing Progress sync login"),
            "{html}"
        );
        assert!(
            html.contains("Log in on this KOReader with the same server URL, username and password as your other no-plugin KOReaders. The password was shown once, when it was generated."),
            "{html}"
        );
        assert!(html.contains("data-testid=\"kosync-url\""), "{html}");
        assert!(html.contains("data-testid=\"kosync-username\""), "{html}");
        assert!(!html.contains("kosync-password"), "{html}");
        assert!(
            html.contains(
                "A new password signs out every no-plugin KOReader until you log in again."
            ),
            "{html}"
        );
    }

    #[test]
    fn koreader_device_row_shows_a_regenerated_login_with_the_devices_to_log_in_again() {
        let html = render_in_vdom(|| no_plugin_row(sync_of(Some(RowPanel::Regenerated(login())))));

        assert!(
            html.contains("New Progress sync login (shown once)"),
            "{html}"
        );
        assert!(html.contains("data-testid=\"kosync-password\""), "{html}");
        assert!(
            html.contains("Log in again on every no-plugin KOReader (here, Libra and Clara): Progress sync \u{203a} Custom sync server \u{203a} Login."),
            "{html}"
        );
    }

    #[test]
    fn koreader_device_row_reads_signed_out_after_a_new_password_was_generated() {
        let html = render_in_vdom(|| {
            no_plugin_row(ProgressSync {
                signed_out: true,
                ..sync_of(None)
            })
        });

        assert!(
            html.contains("data-testid=\"koreader-signed-out\""),
            "{html}"
        );
        assert!(html.contains("Signed out \u{b7} log in again"), "{html}");
    }

    #[test]
    fn koreader_device_row_gives_a_steady_no_plugin_koreader_a_line_and_a_generate_button() {
        let html = render_in_vdom(|| no_plugin_row(sync_of(None)));

        assert!(
            html.contains("Syncs your place through KOReader\u{2019}s Progress sync."),
            "{html}"
        );
        assert!(html.contains("data-testid=\"kosync-generate\""), "{html}");
        assert!(html.contains("Generate a new password"), "{html}");
        assert!(!html.contains("kosync-password"), "{html}");
        assert!(!html.contains("koreader-signed-out"), "{html}");
        assert!(html.contains(r#"aria-label="Remove Libra""#), "{html}");
    }

    #[test]
    fn koreader_card_keeps_the_loading_skeleton_when_only_the_add_form_was_refused() {
        let html = render_in_vdom(|| render_pending_list(false));

        assert!(
            html.contains("data-testid=\"koreader-devices-loading\""),
            "{html}"
        );
        assert!(html.contains("Finding your KOReaders"), "{html}");
    }

    #[test]
    fn koreader_card_draws_no_skeleton_once_the_list_failed_to_load() {
        let html = render_in_vdom(|| render_pending_list(true));

        assert!(!html.contains("koreader-devices-loading"), "{html}");
    }

    #[test]
    fn koreader_device_row_names_the_redownload_link_with_its_visible_text() {
        let html = render_in_vdom(|| plugin_row(Some(1_704_067_200), None));

        assert!(
            html.contains(r#"aria-label="Redownload plugin for Libra""#),
            "{html}"
        );
    }

    #[test]
    fn koreader_card_names_its_device_name_field_after_the_card() {
        let html = render_in_vdom(card);

        assert!(html.contains(r#"id="koreader-card-title""#), "{html}");
        assert!(
            html.contains(r#"aria-labelledby="koreader-card-title koreader-device-name-label""#),
            "{html}"
        );
    }
}
