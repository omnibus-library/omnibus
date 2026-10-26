//! KOReader card (Settings › Devices): the KOReaders registered to the reader.
//!
//! Reads top to bottom: the setup steps (a disclosure, open by default only for a reader with
//! no KOReader yet), the add form, then the registered KOReaders. A plugin row downloads its
//! preconfigured plugin and reports its last sync; Remove asks first. The list and the
//! disclosure's default start unanswered so SSR and the first WASM paint agree.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{DeviceKind, KoboDeviceView};

use super::device_form::{render_add_form, AddForm, NAME_REQUIRED};
use crate::components::confirm_modal::{confirm_dialog, Confirm};
use crate::components::credential_card::action_status;
use crate::components::loading::RowSkeletons;
use crate::pages::settings::use_instance_origin;
use crate::pages::settings::users::fmt_date;
use crate::{data, use_server_url, Route};

/// A plugin row shows "Added just now" for this many seconds after the device is created.
const JUST_ADDED_SECS: i64 = 60;

/// The devices the KOReader card lists: plugin and no-plugin KOReaders. The Kobo card lists the rest.
fn koreader_devices(devices: Vec<KoboDeviceView>) -> Vec<KoboDeviceView> {
    devices
        .into_iter()
        .filter(|d| matches!(d.kind, DeviceKind::Koreader | DeviceKind::Kosync))
        .collect()
}

/// Whether the setup steps start unfolded: until the reader has a KOReader of either kind.
fn koreader_setup_opens_by_default(devices: &[KoboDeviceView]) -> bool {
    !devices
        .iter()
        .any(|d| matches!(d.kind, DeviceKind::Koreader | DeviceKind::Kosync))
}

/// Where a KOReader's preconfigured plugin zip downloads from.
fn plugin_download_url(server_url: &str, id: i64) -> String {
    format!(
        "{}/api/account/kobo-devices/{id}/koreader-plugin",
        server_url.trim_end_matches('/')
    )
}

/// When a plugin row says the device was added: "just now" for a minute, then the date.
fn added_label(created_at: i64, now: i64) -> String {
    if now - created_at < JUST_ADDED_SECS {
        "Added just now".to_string()
    } else {
        format!("Added {}", fmt_date(created_at))
    }
}

/// The card status line after `device` was added.
fn added_message(device: &KoboDeviceView) -> String {
    format!(
        "Added {}. Download its plugin and put it on the device.",
        device.name
    )
}

/// A remove dialog's title and body for the KOReader `name`.
fn remove_confirm_text(name: &str) -> (String, String) {
    (
        format!("Remove {name}?"),
        format!("{name} stops syncing with Omnibus. To sync it again, add it as a new device."),
    )
}

/// The "how to connect" procedure behind a disclosure, plus the standing shelf rule beneath
/// it. The rule is deliberately **not** a numbered item, because a reader working the list has
/// nothing to do at that number.
fn render_koreader_setup(open: bool) -> Element {
    rsx! {
        details { class: "kobo-setup", "data-testid": "koreader-setup", open,
            summary { class: "kobo-setup-summary", "How to connect a KOReader" }
            ol { class: "subtitle kobo-setup-steps", "data-testid": "koreader-setup-steps",
                li {
                    "Give your KOReader a name and click "
                    b { "Add a KOReader" }
                    " below."
                }
                li {
                    "Click "
                    b { "Download plugin" }
                    " on its row. The zip is already set to this server and this KOReader. Anyone holding it can sync as you, so don\u{2019}t share it."
                }
                li {
                    "Unzip it so the "
                    code { translate: "no", "omnibus.koplugin" }
                    " folder sits in KOReader\u{2019}s plugins folder: "
                    code { translate: "no", ".adds/koreader/plugins" }
                    " on a Kobo, "
                    code { translate: "no", "koreader/plugins" }
                    " on a Kindle, "
                    code { translate: "no", "applications/koreader/plugins" }
                    " on a PocketBook, "
                    code { translate: "no", "koreader/plugins" }
                    " on Android."
                }
                li { "Restart KOReader." }
                li {
                    "Open "
                    b { "Tools \u{203a} Omnibus \u{203a} Sync now" }
                    ", in the file browser or the reader."
                }
                li {
                    "No plugin? Tick "
                    b { "Connect without the plugin" }
                    " before adding, then log in under "
                    b { "Progress sync \u{203a} Custom sync server" }
                    " with the login it shows."
                }
            }
            p { class: "subtitle kobo-shelf-rule", "data-testid": "koreader-shelf-rule",
                "Only shelves marked "
                b { "Sync to my devices" }
                " are synced, so set that on a shelf before the first sync. "
                Link { to: Route::Shelves {}, "data-testid": "koreader-shelves-link", "Choose shelves to sync" }
            }
        }
    }
}

/// Registered-KOReader list, or the empty-state line when there are none yet.
fn render_koreader_device_list(
    device_list: &[KoboDeviceView],
    server_url: &str,
    can_download: bool,
    in_flight: bool,
    on_remove: Callback<i64>,
) -> Element {
    if device_list.is_empty() {
        return rsx! {
            p {
                class: "settings-status",
                "data-testid": "koreader-devices-empty",
                "No KOReader registered yet."
            }
        };
    }
    rsx! {
        ul { class: "kobo-device-list", "data-testid": "koreader-device-list",
            for dev in device_list.iter() {
                KoreaderDeviceRow {
                    key: "{dev.id}",
                    plugin_url: plugin_download_url(server_url, dev.id),
                    can_download,
                    device: dev.clone(),
                    disabled: in_flight,
                    on_remove,
                }
            }
        }
    }
}

/// The device awaiting a Remove confirmation.
#[derive(Clone, Debug, PartialEq)]
struct PendingRemove {
    id: i64,
    name: String,
}

/// Card body: setup steps, add form, then the KOReader list. Every mutation folds the
/// server's answer into the list.
#[component]
pub fn KoreaderDevicesCard() -> Element {
    let server_url = use_server_url();
    // Web-only, like the Kobo card: the page's own origin is the server's.
    let origin = use_instance_origin();
    // `None` until the first answer: never "No KOReader registered yet." meanwhile.
    let mut devices = use_signal(|| None::<Vec<KoboDeviceView>>);
    let mut name_input = use_signal(String::new);
    let mut msg = use_signal(|| None::<String>);
    let mut msg_is_error = use_signal(|| false);
    let mut in_flight = use_signal(|| false);
    let mut pending = use_signal(|| None::<PendingRemove>);
    // Decided once, when the list first answers, because adding the first KOReader must not
    // fold the steps away while the reader is still following them.
    let mut setup_open = use_signal(|| false);

    let load_url = server_url.clone();
    use_effect(move || {
        let url = load_url.clone();
        spawn(async move {
            match data::list_kobo_devices(&url).await {
                Ok(list) => {
                    let list = koreader_devices(list);
                    setup_open.set(koreader_setup_opens_by_default(&list));
                    devices.set(Some(list));
                }
                Err(e) => {
                    msg.set(Some(format!("Couldn\u{2019}t load your devices: {e}")));
                    msg_is_error.set(true);
                }
            }
        });
    });

    let add_url = server_url.clone();
    let on_add = use_callback(move |()| {
        let name = name_input().trim().to_string();
        if name.is_empty() {
            msg.set(Some(NAME_REQUIRED.to_string()));
            msg_is_error.set(true);
            return;
        }
        let url = add_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::create_kobo_device(&url, name, DeviceKind::Koreader).await {
                Ok(dev) => {
                    name_input.set(String::new());
                    msg.set(Some(added_message(&dev)));
                    msg_is_error.set(false);
                    devices.write().get_or_insert_with(Vec::new).push(dev);
                }
                Err(e) => {
                    msg.set(Some(e.to_string()));
                    msg_is_error.set(true);
                }
            }
            in_flight.set(false);
        });
    });

    let on_ask_remove = use_callback(move |id: i64| {
        let name = devices
            .peek()
            .iter()
            .flatten()
            .find(|d| d.id == id)
            .map(|d| d.name.clone())
            .unwrap_or_default();
        pending.set(Some(PendingRemove { id, name }));
    });

    let revoke_url = server_url.clone();
    let on_remove = use_callback(move |id: i64| {
        let url = revoke_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::revoke_kobo_device(&url, id).await {
                Ok(()) => {
                    if let Some(list) = devices.write().as_mut() {
                        list.retain(|d| d.id != id);
                    }
                    msg.set(Some("KOReader removed.".to_string()));
                    msg_is_error.set(false);
                }
                Err(e) => {
                    msg.set(Some(e.to_string()));
                    msg_is_error.set(true);
                }
            }
            in_flight.set(false);
            pending.set(None);
        });
    });

    let device_list = devices();
    // Hidden, not disabled, for an account without the permission; shown while the user is
    // unresolved so SSR and the first client paint agree.
    let user = crate::use_current_user_summary();
    let can_download = user().map(|u| u.can_download).unwrap_or(true);

    rsx! {
        section { class: "card", "data-testid": "koreader-devices-card",
            h3 { "KOReader" }
            p { class: "subtitle",
                "Sync your shelves, reading position and highlights to KOReader with the Omnibus plugin, on any device that runs KOReader."
            }
            {render_koreader_setup(setup_open())}
            {render_add_form(AddForm {
                prefix: "koreader",
                placeholder: "e.g. Kobo Libra (KOReader)\u{2026}",
                label: "Add a KOReader",
                name_input,
                in_flight: in_flight(),
                extra: rsx! {},
                status: action_status("koreader-devices-status", msg().as_deref(), msg_is_error()),
                on_submit: on_add,
            })}
            match device_list.as_deref() {
                Some(list) => render_koreader_device_list(list, &origin(), can_download, in_flight(), on_ask_remove),
                // The form's status line carries the failure.
                None if msg_is_error() => rsx! {},
                None => rsx! {
                    div { role: "status", "aria-live": "polite", "data-testid": "koreader-devices-loading",
                        span { class: "ld-sr", "Finding your devices" }
                        RowSkeletons { count: 1, avatar: false }
                    }
                },
            }
        }
        if let Some(ask) = pending() {
            {remove_confirm(ask, in_flight(), pending, on_remove)}
        }
    }
}

/// The dialog confirming a pending Remove, naming the device.
fn remove_confirm(
    ask: PendingRemove,
    busy: bool,
    mut pending: Signal<Option<PendingRemove>>,
    on_remove: Callback<i64>,
) -> Element {
    let (title, body) = remove_confirm_text(&ask.name);
    let id = ask.id;
    confirm_dialog(
        Confirm {
            testid: "koreader-remove-dialog",
            title: &title,
            body: &body,
            action: "Remove device",
            busy_label: "Removing\u{2026}",
        },
        busy,
        EventHandler::new(move |()| pending.set(None)),
        EventHandler::new(move |()| on_remove.call(id)),
    )
}

/// One plugin-KOReader row: its name and sync state, the plugin download, and Remove (which
/// asks before acting).
#[component]
fn KoreaderDeviceRow(
    device: KoboDeviceView,
    plugin_url: String,
    can_download: bool,
    disabled: bool,
    on_remove: Callback<i64>,
) -> Element {
    let id = device.id;
    let name = device.name;
    let synced = device.last_sync_at.is_some();
    let line = match device.last_sync_at {
        Some(at) => format!("Last sync {}", fmt_date(at)),
        None => added_label(device.created_at, crate::time::now_unix()),
    };
    let (download_label, download_class) = if synced {
        ("Redownload plugin", "btn")
    } else {
        ("Download plugin", "btn primary")
    };
    rsx! {
        li { class: "kobo-device-row", "data-testid": "koreader-device-row",
            div { class: "kobo-device-head",
                span { class: "kobo-device-name", "{name}" }
                if !synced {
                    span { class: "users-badge", "data-testid": "koreader-device-badge", "Not synced yet" }
                }
            }
            p { class: "subtitle", "data-testid": "koreader-last-sync", "{line}" }
            if let Some(error) = &device.last_sync_error {
                p { class: "settings-status error", "data-testid": "koreader-last-error",
                    "Last sync failed: {error}"
                }
                p { class: "subtitle",
                    "Redownload the plugin and replace the old copy on the device, then sync again."
                }
            }
            div { class: "settings-actions",
                if can_download {
                    a {
                        class: download_class,
                        href: "{plugin_url}",
                        download: "omnibus-koreader-{id}.zip",
                        "aria-label": "Download the plugin for {name}",
                        "data-testid": "koreader-plugin-download",
                        "{download_label}"
                    }
                }
                button {
                    r#type: "button",
                    class: "btn ghost danger",
                    disabled,
                    "aria-label": "Remove {name}",
                    "data-testid": "koreader-device-remove",
                    onclick: move |_| on_remove.call(id),
                    "Remove"
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
