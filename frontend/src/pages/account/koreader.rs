//! KOReader card (Settings › Devices): the KOReaders registered to the reader, with the plugin
//! or without it.
//!
//! Reads top to bottom: the setup steps (a disclosure, open by default only for a reader with
//! no KOReader yet), the add form with its no-plugin checkbox, then the registered KOReaders.
//! A plugin row downloads its preconfigured plugin and reports its last sync. A no-plugin row
//! stands for a KOReader on stock Progress sync: the account has one login for all of them, shown
//! once on the row that created it and replaceable from any row. Remove asks first. The list and
//! the disclosure's default start unanswered so SSR and the first WASM paint agree.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{DeviceKind, KoboDeviceView, KosyncPassword};

use super::device_form::{render_add_form, render_list_loading, AddForm, NAME_REQUIRED};
use crate::components::clipboard::ReadonlyCopyField;
use crate::components::confirm_modal::{confirm_dialog, Confirm};
use crate::components::credential_card::action_status;
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
    let name = &device.name;
    match (device.kind, &device.kosync_login) {
        (DeviceKind::Kosync, Some(_)) => {
            format!("Added {name}. Copy its login now: the password is shown once.")
        }
        (DeviceKind::Kosync, None) => format!("Added {name}."),
        _ => format!("Added {name}. Download its plugin and put it on the device."),
    }
}

/// The custom sync server a reader types into KOReader: `{origin}/kosync`, no trailing slash.
fn kosync_url(origin: &str) -> String {
    format!("{}/kosync", origin.trim_end_matches('/'))
}

/// `names` as a sentence fragment: "A", "A and B", "A, B and C".
fn join_names(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [only] => only.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}

/// The generate dialog's title and body, naming every no-plugin KOReader it signs out.
fn generate_confirm_text(names: &[String]) -> (String, String) {
    let (verb, its, them) = if names.len() == 1 {
        ("stops", "its", "it")
    } else {
        ("stop", "their", "them")
    };
    (
        "Generate a new Progress sync password?".to_string(),
        format!(
            "{} {verb} syncing {its} place until you log in on {them} again with the new \
             password. Every no-plugin KOReader shares this one login. Plugin KOReaders and \
             Kobos aren\u{2019}t affected.",
            join_names(names)
        ),
    )
}

/// A remove dialog's title and body for the KOReader `name`; the last no-plugin KOReader also
/// takes the Progress sync login with it.
fn remove_confirm_text(name: &str, last_no_plugin: bool) -> (String, String) {
    let body = if last_no_plugin {
        format!(
            "{name} stops syncing with Omnibus. It\u{2019}s your last no-plugin KOReader, so this \
             also turns off Progress sync: its password stops working."
        )
    } else {
        format!("{name} stops syncing with Omnibus. To sync it again, add it as a new device.")
    };
    (format!("Remove {name}?"), body)
}

/// Whether removing device `id` removes the account's last no-plugin KOReader.
fn is_last_no_plugin(devices: &[KoboDeviceView], id: i64) -> bool {
    let no_plugin = |d: &&KoboDeviceView| d.kind == DeviceKind::Kosync;
    devices.iter().filter(no_plugin).count() == 1
        && devices
            .iter()
            .any(|d| d.id == id && d.kind == DeviceKind::Kosync)
}

/// The names of every no-plugin KOReader in `devices`.
fn no_plugin_names(devices: &[KoboDeviceView]) -> Vec<String> {
    devices
        .iter()
        .filter(|d| d.kind == DeviceKind::Kosync)
        .map(|d| d.name.clone())
        .collect()
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

/// What a no-plugin row shows under its name this session. Nothing here survives a reload: the
/// server keeps no password to show.
#[derive(Clone, Debug, PartialEq)]
enum RowPanel {
    /// The login this row's add created.
    Fresh(KosyncPassword),
    /// This row's add reused the account's existing login.
    Reuse,
    /// The login a Generate from this row just made.
    Regenerated(KosyncPassword),
}

/// Everything a no-plugin row needs beyond its device.
#[derive(Clone, Debug, Default, PartialEq)]
struct ProgressSync {
    panel: Option<RowPanel>,
    /// A new password was generated here since the page loaded, so every no-plugin KOReader must log in again.
    signed_out: bool,
    server_url: String,
    username: String,
    /// Every no-plugin KOReader's name, as a sentence fragment.
    all_names: String,
}

/// The list's data besides the devices themselves.
struct ListView<'a> {
    origin: &'a str,
    can_download: bool,
    in_flight: bool,
    signed_out: bool,
    username: &'a str,
    panels: &'a [(i64, RowPanel)],
}

/// Registered-KOReader list, or the empty-state line when there are none yet.
fn render_koreader_device_list(
    device_list: &[KoboDeviceView],
    view: &ListView,
    on_generate: Callback<i64>,
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
    let all_names = join_names(&no_plugin_names(device_list));
    rsx! {
        ul { class: "kobo-device-list", "data-testid": "koreader-device-list",
            for dev in device_list.iter() {
                KoreaderDeviceRow {
                    key: "{dev.id}",
                    plugin_url: plugin_download_url(view.origin, dev.id),
                    can_download: view.can_download,
                    device: dev.clone(),
                    disabled: view.in_flight,
                    on_remove,
                    on_generate,
                    sync: ProgressSync {
                        panel: view.panels.iter().find(|(id, _)| *id == dev.id).map(|(_, p)| p.clone()),
                        signed_out: view.signed_out,
                        server_url: kosync_url(view.origin),
                        username: view.username.to_string(),
                        all_names: all_names.clone(),
                    },
                }
            }
        }
    }
}

/// The action awaiting confirmation.
#[derive(Clone, Debug, PartialEq)]
enum Pending {
    Remove {
        id: i64,
        name: String,
        last_no_plugin: bool,
    },
    /// Generating from row `id`, which signs out every KOReader in `names`.
    Generate { id: i64, names: Vec<String> },
}

/// The checkbox that makes the next add a no-plugin KOReader, with the line saying what that means.
fn render_no_plugin_option(no_plugin: Signal<bool>, disabled: bool) -> Element {
    rsx! {
        div { class: "device-add-option",
            label { class: "device-add-check", r#for: "koreader-no-plugin",
                input {
                    r#type: "checkbox",
                    id: "koreader-no-plugin",
                    "data-testid": "koreader-no-plugin",
                    checked: no_plugin(),
                    disabled,
                    onchange: move |e| { let mut no_plugin = no_plugin; no_plugin.set(e.checked()) },
                }
                span { "Connect without the plugin (Progress sync only)" }
            }
            p { class: "subtitle device-add-hint",
                "For a KOReader you\u{2019}d rather not install the plugin on. It uses KOReader\u{2019}s built-in Progress sync, which keeps only your place in step: no shelves, no highlights."
            }
        }
    }
}

/// The list's stand-in until it answers; a refused add never hides it.
fn render_pending_list(load_failed: bool) -> Element {
    render_list_loading(load_failed, "koreader", "KOReaders")
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
    let mut no_plugin = use_signal(|| false);
    let mut msg = use_signal(|| None::<String>);
    let mut msg_is_error = use_signal(|| false);
    let mut load_failed = use_signal(|| false);
    let mut in_flight = use_signal(|| false);
    let mut pending = use_signal(|| None::<Pending>);
    let mut panels = use_signal(Vec::<(i64, RowPanel)>::new);
    let mut signed_out = use_signal(|| false);
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
                    load_failed.set(true);
                    msg.set(Some(format!("Couldn\u{2019}t load your KOReaders: {e}")));
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
        let kind = if no_plugin() {
            DeviceKind::Kosync
        } else {
            DeviceKind::Koreader
        };
        let url = add_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::create_kobo_device(&url, name, kind).await {
                Ok(dev) => {
                    name_input.set(String::new());
                    no_plugin.set(false);
                    if kind == DeviceKind::Kosync {
                        let panel = match &dev.kosync_login {
                            Some(login) => RowPanel::Fresh(login.clone()),
                            None => RowPanel::Reuse,
                        };
                        if dev.kosync_login.is_some() {
                            signed_out.set(false);
                        }
                        panels.write().push((dev.id, panel));
                    }
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
        let list = devices.peek();
        let list = list.as_deref().unwrap_or_default();
        let name = list
            .iter()
            .find(|d| d.id == id)
            .map(|d| d.name.clone())
            .unwrap_or_default();
        pending.set(Some(Pending::Remove {
            id,
            name,
            last_no_plugin: is_last_no_plugin(list, id),
        }));
    });
    let on_ask_generate = use_callback(move |id: i64| {
        let names = no_plugin_names(devices.peek().as_deref().unwrap_or_default());
        pending.set(Some(Pending::Generate { id, names }));
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
                        if no_plugin_names(list).is_empty() {
                            signed_out.set(false);
                        }
                    }
                    panels.write().retain(|(panel_id, _)| *panel_id != id);
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

    let generate_url = server_url.clone();
    let on_generate = use_callback(move |id: i64| {
        let url = generate_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::generate_kosync_password(&url).await {
                Ok(login) => {
                    // The old password is dead, so no earlier panel may still claim to show it.
                    panels.set(vec![(id, RowPanel::Regenerated(login))]);
                    signed_out.set(true);
                    msg.set(Some(
                        "New password generated. Copy it now: it is shown once.".to_string(),
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

    let device_list = devices();
    // Hidden, not disabled, for an account without the permission; shown while the user is
    // unresolved so SSR and the first client paint agree.
    let user = crate::use_current_user_summary();
    let can_download = user().map(|u| u.can_download).unwrap_or(true);
    let username = user().map(|u| u.username).unwrap_or_default();

    rsx! {
        section { class: "card", "data-testid": "koreader-devices-card",
            h3 { id: "koreader-card-title", "KOReader" }
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
                extra: render_no_plugin_option(no_plugin, in_flight()),
                status: action_status("koreader-devices-status", msg().as_deref(), msg_is_error()),
                on_submit: on_add,
            })}
            match device_list.as_deref() {
                Some(list) => render_koreader_device_list(
                    list,
                    &ListView {
                        origin: &origin(),
                        can_download,
                        in_flight: in_flight(),
                        signed_out: signed_out(),
                        username: &username,
                        panels: &panels(),
                    },
                    on_ask_generate,
                    on_ask_remove,
                ),
                None => render_pending_list(load_failed()),
            }
        }
        if let Some(ask) = pending() {
            {pending_confirm(ask, in_flight(), pending, on_generate, on_remove)}
        }
    }
}

/// The dialog confirming a pending Remove or Generate, naming the devices it affects.
fn pending_confirm(
    ask: Pending,
    busy: bool,
    mut pending: Signal<Option<Pending>>,
    on_generate: Callback<i64>,
    on_remove: Callback<i64>,
) -> Element {
    let (testid, (title, body), action, busy_label, run) = match ask {
        Pending::Remove {
            id,
            name,
            last_no_plugin,
        } => (
            "koreader-remove-dialog",
            remove_confirm_text(&name, last_no_plugin),
            "Remove device",
            "Removing\u{2026}",
            EventHandler::new(move |()| on_remove.call(id)),
        ),
        Pending::Generate { id, names } => (
            "kosync-replace-dialog",
            generate_confirm_text(&names),
            "Generate new password",
            "Generating\u{2026}",
            EventHandler::new(move |()| on_generate.call(id)),
        ),
    };
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
        run,
    )
}

/// One revealed value: a label, a read-only field and a copy button. The id carries the device
/// id, so two rows showing a login never share one.
fn login_field(device_id: i64, key: &str, label: &str, value: &str, name: &str) -> Element {
    rsx! {
        ReadonlyCopyField {
            id: "kosync-{key}-{device_id}",
            label: label.to_string(),
            value: value.to_string(),
            input_testid: "kosync-{key}",
            copy_label: "Copy",
            copy_testid: "kosync-{key}-copy",
            copy_aria_label: format!("Copy the {} for {name}", label.to_lowercase()),
        }
    }
}

/// A login shown once: its three fields under `title`, with `tip` beneath.
fn render_login_panel(
    title: &str,
    tip: String,
    server_url: &str,
    login: &KosyncPassword,
    id: i64,
    name: &str,
) -> Element {
    rsx! {
        div { class: "kosync-login", "data-testid": "koreader-login-panel",
            p { class: "kosync-login-title", "{title}" }
            {login_field(id, "url", "Server URL", server_url, name)}
            {login_field(id, "username", "Username", &login.username, name)}
            {login_field(id, "password", "Password", &login.password, name)}
            p { class: "subtitle", "{tip}" }
        }
    }
}

/// A no-plugin row's body: the login it just showed, the login it reuses, or a steady line.
fn render_progress_sync(sync: &ProgressSync, id: i64, name: &str) -> Element {
    match &sync.panel {
        Some(RowPanel::Fresh(login)) => render_login_panel(
            "Progress sync login (shown once)",
            "In KOReader: Progress sync \u{203a} Custom sync server, then Login with these. Every no-plugin KOReader shares this one login. Only books downloaded from Omnibus match.".to_string(),
            &sync.server_url,
            login,
            id,
            name,
        ),
        Some(RowPanel::Regenerated(login)) => render_login_panel(
            "New Progress sync login (shown once)",
            format!(
                "Log in again on every no-plugin KOReader (here, {}): Progress sync \u{203a} Custom sync server \u{203a} Login.",
                sync.all_names
            ),
            &sync.server_url,
            login,
            id,
            name,
        ),
        Some(RowPanel::Reuse) => {
            rsx! {
                div { class: "kosync-login", "data-testid": "koreader-login-panel",
                    p { class: "kosync-login-title", "Uses your existing Progress sync login" }
                    p { class: "subtitle",
                        "Log in on this KOReader with the same server URL, username and password as your other no-plugin KOReaders. The password was shown once, when it was generated."
                    }
                    {login_field(id, "url", "Server URL", &sync.server_url, name)}
                    {login_field(id, "username", "Username", &sync.username, name)}
                    p { class: "subtitle",
                        "A new password signs out every no-plugin KOReader until you log in again."
                    }
                }
            }
        }
        None => rsx! {
            p { class: "subtitle", "Syncs your place through KOReader\u{2019}s Progress sync." }
        },
    }
}

/// A plugin row's sync line: when it was added, or its last sync and any failure.
fn render_plugin_state(device: &KoboDeviceView) -> Element {
    let line = match device.last_sync_at {
        Some(at) => format!("Last sync {}", fmt_date(at)),
        None => added_label(device.created_at, crate::time::now_unix()),
    };
    rsx! {
        p { class: "subtitle", "data-testid": "koreader-last-sync", "{line}" }
        if let Some(error) = &device.last_sync_error {
            p { class: "settings-status error", "data-testid": "koreader-last-error",
                "Last sync failed: {error}"
            }
            p { class: "subtitle",
                "Redownload the plugin and replace the old copy on the device, then sync again."
            }
        }
    }
}

/// One KOReader row: its name and state, then what that kind of KOReader does (a plugin
/// download, or the Progress sync login), and Remove, which asks before acting.
#[component]
fn KoreaderDeviceRow(
    device: KoboDeviceView,
    plugin_url: String,
    can_download: bool,
    disabled: bool,
    on_remove: Callback<i64>,
    on_generate: Callback<i64>,
    #[props(default)] sync: ProgressSync,
) -> Element {
    let id = device.id;
    let no_plugin = device.kind == DeviceKind::Kosync;
    let synced = device.last_sync_at.is_some();
    let (download_label, download_class) = if synced {
        ("Redownload plugin", "btn")
    } else {
        ("Download plugin", "btn primary")
    };
    let name = device.name.clone();
    rsx! {
        li { class: "kobo-device-row", "data-testid": "koreader-device-row",
            div { class: "kobo-device-head",
                div { class: "kobo-device-title",
                    span { class: "kobo-device-name", "{name}" }
                    if no_plugin {
                        span { class: "users-badge", "data-testid": "koreader-device-badge", "No plugin" }
                    } else if !synced {
                        span { class: "users-badge", "data-testid": "koreader-device-badge", "Not synced yet" }
                    }
                }
                if no_plugin {
                    if sync.signed_out {
                        span { class: "kobo-row-status error", "data-testid": "koreader-signed-out",
                            "Signed out \u{b7} log in again"
                        }
                    } else {
                        span { class: "kobo-row-status", "Progress sync" }
                    }
                }
            }
            if no_plugin {
                {render_progress_sync(&sync, id, &name)}
            } else {
                {render_plugin_state(&device)}
            }
            div { class: "settings-actions",
                if no_plugin {
                    button {
                        r#type: "button",
                        class: "btn ghost",
                        disabled,
                        "aria-label": "Generate a new password for {name}",
                        "data-testid": "kosync-generate",
                        onclick: move |_| on_generate.call(id),
                        "Generate a new password"
                    }
                } else if can_download {
                    a {
                        class: download_class,
                        href: "{plugin_url}",
                        download: "omnibus-koreader-{id}.zip",
                        "aria-label": "{download_label} for {name}",
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
