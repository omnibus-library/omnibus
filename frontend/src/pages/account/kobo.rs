//! Kobo wireless-sync device card (Settings › Devices).
//!
//! Reads top to bottom: the first-sync warning, the setup steps (a disclosure,
//! open by default only for a reader with no Kobo yet), the add form, then the
//! registered Kobos with their re-displayable `api_endpoint` URL, copy button
//! and per-device Regenerate/Remove. Both ask first, since either breaks the
//! device's sync until it is re-set over USB. The list and the
//! disclosure's default start unanswered so SSR and the first WASM paint agree.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::KoboDeviceView;

use crate::components::clipboard::CopyButton;
use crate::components::confirm_modal::{confirm_dialog, Confirm};
use crate::components::credential_card::action_status;
use crate::components::loading::RowSkeletons;
use crate::components::BusyLabel;
use crate::pages::settings::use_instance_origin;
use crate::{data, use_server_url, Route};

/// A device action that needs confirming.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum KoboAction {
    Regenerate,
    Remove,
}

/// The device action awaiting confirmation.
#[derive(Clone, Debug, PartialEq)]
struct PendingKobo {
    action: KoboAction,
    id: i64,
    name: String,
}

/// A confirm dialog's title and body for `action` on the device `name`.
fn kobo_confirm_text(action: KoboAction, name: &str) -> (String, String) {
    match action {
        KoboAction::Regenerate => (
            format!("Regenerate the token for {name}?"),
            format!(
                "{name} stops syncing until you replace its api_endpoint with the new URL over USB."
            ),
        ),
        KoboAction::Remove => (
            format!("Remove {name}?"),
            format!("{name} stops syncing with Omnibus. To sync it again, add it as a new device."),
        ),
    }
}

/// The `api_endpoint` a Kobo is pointed at: `{origin}/kobo/{token}`. The reader
/// appends `/v1/…` itself.
fn endpoint_url(server_url: &str, token: &str) -> String {
    format!("{}/kobo/{token}", server_url.trim_end_matches('/'))
}

/// The backup tool whose TUI also sets a Kobo's sync URL.
const KOBO_BACKUP_URL: &str = "https://github.com/omnibus-library/kobo-backup";

/// The "how to connect" procedure behind a disclosure, plus the standing shelf
/// rule beneath it. The rule is deliberately **not** a numbered item, because a
/// reader working the list has nothing to do at that number.
fn render_kobo_setup(open: bool) -> Element {
    rsx! {
        details { class: "kobo-setup", "data-testid": "kobo-setup", open,
            summary { class: "kobo-setup-summary", "How to connect a Kobo" }
            ol { class: "subtitle kobo-setup-steps", "data-testid": "kobo-setup-steps",
                li {
                    "Give your Kobo a name and click "
                    b { "Add device" }
                    " below."
                }
                li {
                    "Copy the whole "
                    b { "Wireless sync endpoint" }
                    " URL shown for it. It must be reachable from the Kobo\u{2019}s own Wi-Fi."
                }
                li { "Connect the Kobo over USB and tap Connect on the device." }
                li {
                    "Edit "
                    code { translate: "no", ".kobo/Kobo/Kobo eReader.conf" }
                    " and set "
                    code { translate: "no", "api_endpoint=" }
                    " under "
                    code { translate: "no", "[OneStoreServices]" }
                    " to the URL you copied, or let the "
                    a { href: KOBO_BACKUP_URL, target: "_blank", rel: "noopener noreferrer",
                        "omnibus-library/kobo-backup"
                    }
                    " TUI set it for you."
                }
                li { "Eject safely. Your next sync on the device talks to Omnibus." }
            }
            p { class: "subtitle kobo-shelf-rule", "data-testid": "kobo-shelf-rule",
                "Only shelves marked "
                b { "Sync to Kobo" }
                " are synced, so set that on a shelf before the first sync. "
                Link { to: Route::Shelves {}, "data-testid": "kobo-shelves-link", "Choose shelves to sync" }
            }
        }
    }
}

/// The unconditional first-sync data-loss warning, with backup tool links.
fn render_kobo_warning() -> Element {
    rsx! {
        div { class: "kobo-warning", "data-testid": "kobo-data-loss-warning",
            p { class: "kobo-warning-title", "First sync can erase your Kobo\u{2019}s highlights" }
            p {
                "An improper sync can potentially wipe data on the Kobo like your "
                "annotations, notes, bookmarks, reading progress, and books."
            }
            p {
                "It is highly recommended to back up your device before attempting "
                "a sync with one of these tools:"
            }
            ul { class: "kobo-warning-tools",
                li {
                    a { href: KOBO_BACKUP_URL, target: "_blank", rel: "noopener noreferrer",
                        "omnibus-library/kobo-backup"
                    }
                    ", whose TUI also sets your Kobo\u{2019}s sync URL for you"
                }
                li {
                    a {
                        href: "https://github.com/karlicoss/kobuddy#usage",
                        target: "_blank",
                        rel: "noopener noreferrer",
                        "karlicoss/kobuddy"
                    }
                }
            }
            p {
                "At minimum, copy "
                code { translate: "no", ".kobo/KoboReader.sqlite" }
                " off the device over USB."
            }
        }
    }
}

/// Registered-device list, or the empty-state line when there are none yet.
fn render_kobo_device_list(
    device_list: &[KoboDeviceView],
    server_url: &str,
    in_flight: bool,
    on_regenerate: Callback<i64>,
    on_remove: Callback<i64>,
) -> Element {
    if device_list.is_empty() {
        return rsx! {
            p {
                class: "settings-status",
                "data-testid": "kobo-devices-empty",
                "No Kobo registered yet."
            }
        };
    }
    rsx! {
        ul { class: "kobo-device-list", "data-testid": "kobo-device-list",
            for dev in device_list.iter() {
                KoboDeviceRow {
                    key: "{dev.id}",
                    endpoint: endpoint_url(server_url, &dev.token),
                    device: dev.clone(),
                    disabled: in_flight,
                    on_regenerate,
                    on_remove,
                }
            }
        }
    }
}

/// The "Add a Kobo" name form, with the card's status beside its action.
fn render_kobo_add_form(
    name_input: Signal<String>,
    in_flight: bool,
    status: Element,
    on_add: impl FnMut(Event<FormData>) + 'static,
) -> Element {
    rsx! {
        form {
            id: "kobo-add-form",
            class: "settings-form",
            onsubmit: on_add,
            div { class: "settings-field",
                label { r#for: "kobo-device-name", "Device name" }
                input {
                    r#type: "text",
                    id: "kobo-device-name",
                    name: "kobo_device_name",
                    "data-testid": "kobo-device-name-input",
                    autocomplete: "off",
                    placeholder: "e.g. Kobo Clara\u{2026}",
                    maxlength: "100",
                    value: "{name_input}",
                    oninput: move |e| { let mut name_input = name_input; name_input.set(e.value()) },
                }
            }
            div { class: "settings-actions",
                {status}
                button {
                    r#type: "submit",
                    class: "btn primary",
                    disabled: in_flight,
                    "aria-busy": "{in_flight}",
                    "data-testid": "kobo-device-add",
                    BusyLabel { busy: in_flight, label: "Add device", busy_label: "Adding\u{2026}" }
                }
            }
        }
    }
}

/// Card body: warning, setup steps, add form, then the device list. Every
/// mutation folds the server's answer into the list.
#[component]
pub fn KoboDevicesCard() -> Element {
    let server_url = use_server_url();
    // This card only mounts on web (`mod kobo` is `not(feature = "mobile")`),
    // which co-locates with the server, so the page's own origin is the
    // endpoint's origin.
    let endpoint_origin = use_instance_origin();
    // `None` until the first answer: never "No Kobo registered yet." meanwhile.
    let mut devices = use_signal(|| None::<Vec<KoboDeviceView>>);
    let mut name_input = use_signal(String::new);
    let mut msg = use_signal(|| None::<String>);
    let mut msg_is_error = use_signal(|| false);
    let mut in_flight = use_signal(|| false);
    let mut pending = use_signal(|| None::<PendingKobo>);
    // Decided once, when the list first answers, because adding the first Kobo
    // must not fold the steps away while the reader is still following them.
    let mut setup_open = use_signal(|| false);

    let load_url = server_url.clone();
    use_effect(move || {
        let url = load_url.clone();
        spawn(async move {
            match data::list_kobo_devices(&url).await {
                Ok(list) => {
                    setup_open.set(list.is_empty());
                    devices.set(Some(list));
                }
                Err(e) => {
                    msg.set(Some(format!("Couldn\u{2019}t load your Kobos: {e}")));
                    msg_is_error.set(true);
                }
            }
        });
    });

    let add_url = server_url.clone();
    let on_add = move |evt: Event<FormData>| {
        evt.prevent_default();
        let name = name_input().trim().to_string();
        if name.is_empty() {
            msg.set(Some("Enter a name for your Kobo.".to_string()));
            msg_is_error.set(true);
            return;
        }
        let url = add_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::create_kobo_device(&url, name).await {
                Ok(dev) => {
                    name_input.set(String::new());
                    devices.write().get_or_insert_with(Vec::new).push(dev);
                    msg.set(Some("Kobo added. Copy its endpoint URL below.".to_string()));
                    msg_is_error.set(false);
                }
                Err(e) => {
                    msg.set(Some(e.to_string()));
                    msg_is_error.set(true);
                }
            }
            in_flight.set(false);
        });
    };

    // `use_callback` handles are `Copy`, so they survive being passed into each
    // row inside the `for` loop below (a plain closure would move on first use).
    // The row buttons only ask; the dialog's confirm runs the action.
    let ask = move |action: KoboAction| {
        move |id: i64| {
            let name = devices
                .peek()
                .iter()
                .flatten()
                .find(|d| d.id == id)
                .map(|d| d.name.clone())
                .unwrap_or_default();
            pending.set(Some(PendingKobo { action, id, name }));
        }
    };
    let on_ask_regenerate = use_callback(ask(KoboAction::Regenerate));
    let on_ask_remove = use_callback(ask(KoboAction::Remove));

    let regen_url = server_url.clone();
    let on_regenerate = use_callback(move |id: i64| {
        let url = regen_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::regenerate_kobo_device(&url, id).await {
                Ok(updated) => {
                    if let Some(slot) = devices.write().iter_mut().flatten().find(|d| d.id == id) {
                        *slot = updated;
                    }
                    msg.set(Some(
                        "Token regenerated. Update the URL on your Kobo.".to_string(),
                    ));
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
                    msg.set(Some("Kobo removed.".to_string()));
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

    rsx! {
        section { class: "card", "data-testid": "kobo-devices-card",
            h3 { "Kobo wireless sync" }
            p { class: "subtitle", "Sync your shelves to a Kobo over Wi-Fi." }
            // Unconditional: the hazard applies the moment a URL is copied.
            {render_kobo_warning()}
            {render_kobo_setup(setup_open())}
            {render_kobo_add_form(
                name_input,
                in_flight(),
                action_status("kobo-devices-status", msg().as_deref(), msg_is_error()),
                on_add,
            )}
            match device_list.as_deref() {
                Some(list) => render_kobo_device_list(list, &endpoint_origin(), in_flight(), on_ask_regenerate, on_ask_remove),
                // The form's status line carries the failure.
                None if msg_is_error() => rsx! {},
                None => rsx! {
                    div { role: "status", "aria-live": "polite", "data-testid": "kobo-devices-loading",
                        span { class: "ld-sr", "Finding your Kobos" }
                        RowSkeletons { count: 1, avatar: false }
                    }
                },
            }
        }
        if let Some(ask) = pending() {
            {kobo_confirm(ask, in_flight(), pending, on_regenerate, on_remove)}
        }
    }
}

/// The dialog confirming a pending Regenerate or Remove, naming the device.
fn kobo_confirm(
    ask: PendingKobo,
    busy: bool,
    mut pending: Signal<Option<PendingKobo>>,
    on_regenerate: Callback<i64>,
    on_remove: Callback<i64>,
) -> Element {
    let (title, body) = kobo_confirm_text(ask.action, &ask.name);
    let (testid, action, busy_label, run) = match ask.action {
        KoboAction::Regenerate => (
            "kobo-regenerate-dialog",
            "Regenerate token",
            "Regenerating\u{2026}",
            on_regenerate,
        ),
        KoboAction::Remove => (
            "kobo-remove-dialog",
            "Remove device",
            "Removing\u{2026}",
            on_remove,
        ),
    };
    let id = ask.id;
    confirm_dialog(
        Confirm {
            testid,
            title: &title,
            body: &body,
            action,
            busy_label,
        },
        busy,
        EventHandler::new(move |()| pending.set(None)),
        EventHandler::new(move |()| run.call(id)),
    )
}

/// One device row: label, the readonly endpoint URL and its copy button, and
/// the Regenerate / Remove actions, which ask before acting.
#[component]
fn KoboDeviceRow(
    device: KoboDeviceView,
    endpoint: String,
    disabled: bool,
    on_regenerate: Callback<i64>,
    on_remove: Callback<i64>,
) -> Element {
    let id = device.id;
    let name = device.name;
    rsx! {
        li { class: "kobo-device-row", "data-testid": "kobo-device-row",
            div { class: "kobo-device-head",
                span { class: "kobo-device-name", "{name}" }
            }
            div { class: "settings-field",
                label { r#for: "kobo-endpoint-{id}", "Wireless sync endpoint" }
                div { class: "kobo-endpoint-row",
                    input {
                        r#type: "text",
                        id: "kobo-endpoint-{id}",
                        class: "kobo-endpoint-url",
                        "data-testid": "kobo-endpoint-url",
                        translate: "no",
                        spellcheck: "false",
                        readonly: true,
                        value: "{endpoint}",
                    }
                    CopyButton {
                        text: endpoint.clone(),
                        label: "Copy URL",
                        testid: "kobo-endpoint-copy",
                        aria_label: format!("Copy the endpoint URL for {name}"),
                    }
                }
            }
            div { class: "settings-actions",
                button {
                    r#type: "button",
                    class: "btn ghost",
                    disabled,
                    "aria-label": "Regenerate token for {name}",
                    "data-testid": "kobo-device-regenerate",
                    onclick: move |_| on_regenerate.call(id),
                    "Regenerate"
                }
                button {
                    r#type: "button",
                    class: "btn ghost danger",
                    disabled,
                    "aria-label": "Remove {name}",
                    "data-testid": "kobo-device-remove",
                    onclick: move |_| on_remove.call(id),
                    "Remove"
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
