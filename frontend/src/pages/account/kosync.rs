//! KOReader progress-sync card (Settings › Devices): whether the reader has a sync password
//! for stock KOReader's Progress sync, and generating one. The password is shown once, right
//! after it is made, and never again; generating another replaces it, so that asks first. The
//! status starts unanswered so SSR and the first WASM paint agree.

use dioxus::prelude::*;
use omnibus_shared::KosyncPassword;

use crate::components::clipboard::ReadonlyCopyField;
use crate::components::confirm_modal::{confirm_dialog, Confirm};
use crate::components::credential_card::action_status;
use crate::components::loading::{Loading, LoadingKind};
use crate::components::BusyLabel;
use crate::pages::settings::use_instance_origin;
use crate::{data, use_server_url};

/// The custom sync server a reader types into KOReader: `{origin}/kosync`, no trailing slash.
fn kosync_url(origin: &str) -> String {
    format!("{}/kosync", origin.trim_end_matches('/'))
}

/// The generate button's label.
fn generate_label(configured: bool) -> &'static str {
    if configured {
        "Generate a new password"
    } else {
        "Generate password"
    }
}

/// The replace dialog's title and body.
fn replace_confirm_text() -> (&'static str, &'static str) {
    (
        "Generate a new password?",
        "The current password stops working, so KOReader stops syncing progress until you \
         log in again with the new one.",
    )
}

/// One revealed value: a label, a read-only field and a copy button.
fn revealed_field(id: &'static str, label: &'static str, value: &str) -> Element {
    rsx! {
        ReadonlyCopyField {
            id: "kosync-{id}",
            label,
            value: value.to_string(),
            input_testid: "kosync-{id}",
            copy_label: "Copy",
            copy_testid: "kosync-{id}-copy",
            copy_aria_label: format!("Copy the {}", label.to_lowercase()),
        }
    }
}

/// The status line: a loader until the read answers, then On or Off, or that it could not be read.
fn render_status(status: Option<bool>, failed: bool) -> Element {
    match (status, failed) {
        (Some(on), _) => rsx! {
            p { "data-testid": "kosync-status", if on { "On" } else { "Off" } }
        },
        (None, true) => rsx! {
            p { "data-testid": "kosync-status", "Status unavailable" }
        },
        (None, false) => rsx! {
            Loading {
                kind: LoadingKind::Section,
                class: "start",
                testid: "kosync-loading",
                label: "Checking progress sync\u{2026}",
            }
        },
    }
}

/// Whether generating must ask first: anything but a known absence may hold a password to replace.
fn generate_needs_confirm(status: Option<bool>) -> bool {
    status != Some(false)
}

/// Whether the generate button is off: while the status is still loading, or a request runs.
fn generate_disabled(status: Option<bool>, status_failed: bool, in_flight: bool) -> bool {
    (status.is_none() && !status_failed) || in_flight
}

/// The card status line after a generate: its text, and whether it is an error.
fn generate_outcome(result: Result<(), String>) -> (String, bool) {
    match result {
        Ok(()) => (
            "Password generated. Copy it now: it is shown once.".to_string(),
            false,
        ),
        Err(e) => (e, true),
    }
}

/// The freshly generated login, with the steps to use it.
fn render_revealed(origin: &str, login: &KosyncPassword) -> Element {
    rsx! {
        div { "data-testid": "kosync-revealed",
            {revealed_field("url", "Server URL", &kosync_url(origin))}
            {revealed_field("username", "Username", &login.username)}
            {revealed_field("password", "Password", &login.password)}
            p { class: "subtitle",
                "Shown once. In KOReader: Progress sync \u{203a} Custom sync server, then Login."
            }
        }
    }
}

/// Card body: status, the generate action, and the one-time reveal.
#[component]
pub fn KosyncCard() -> Element {
    let server_url = use_server_url();
    let origin = use_instance_origin();
    // `None` until the first answer: never "Off" meanwhile.
    let mut configured = use_signal(|| None::<bool>);
    let mut revealed = use_signal(|| None::<KosyncPassword>);
    let mut msg = use_signal(|| None::<String>);
    let mut msg_is_error = use_signal(|| false);
    let mut in_flight = use_signal(|| false);
    let mut confirming = use_signal(|| false);
    let mut status_failed = use_signal(|| false);

    let load_url = server_url.clone();
    use_effect(move || {
        let url = load_url.clone();
        spawn(async move {
            match data::kosync_status(&url).await {
                Ok(status) => configured.set(Some(status.configured)),
                Err(e) => {
                    status_failed.set(true);
                    msg.set(Some(format!("Couldn\u{2019}t check progress sync: {e}")));
                    msg_is_error.set(true);
                }
            }
        });
    });

    let generate_url = server_url.clone();
    let on_generate = use_callback(move |()| {
        let url = generate_url.clone();
        in_flight.set(true);
        spawn(async move {
            let result = data::generate_kosync_password(&url).await;
            let (text, is_error) =
                generate_outcome(result.as_ref().map(|_| ()).map_err(|e| e.to_string()));
            if let Ok(login) = result {
                revealed.set(Some(login));
                configured.set(Some(true));
            }
            msg.set(Some(text));
            msg_is_error.set(is_error);
            in_flight.set(false);
            confirming.set(false);
        });
    });

    let status = configured();
    rsx! {
        section { class: "card", "data-testid": "kosync-card",
            h3 { "KOReader progress sync" }
            p { class: "subtitle",
                "Sync your reading position with KOReader\u{2019}s built-in Progress sync, no plugin needed. "
                "Only books downloaded from Omnibus match."
            }
            {render_status(status, status_failed())}
            if let Some(login) = revealed() {
                {render_revealed(&origin(), &login)}
            }
            div { class: "settings-actions",
                {action_status("kosync-card-status", msg().as_deref(), msg_is_error())}
                button {
                    r#type: "button",
                    class: "btn primary",
                    disabled: generate_disabled(status, status_failed(), in_flight()),
                    "aria-busy": "{in_flight()}",
                    "data-testid": "kosync-generate",
                    onclick: move |_| {
                        if generate_needs_confirm(status) {
                            confirming.set(true);
                        } else {
                            on_generate.call(());
                        }
                    },
                    BusyLabel {
                        busy: in_flight(),
                        label: generate_label(status == Some(true)),
                        busy_label: "Generating\u{2026}",
                    }
                }
            }
        }
        if confirming() {
            {replace_confirm(in_flight(), confirming, on_generate)}
        }
    }
}

/// The dialog confirming a replacement password.
fn replace_confirm(busy: bool, mut confirming: Signal<bool>, on_generate: Callback<()>) -> Element {
    let (title, body) = replace_confirm_text();
    confirm_dialog(
        Confirm {
            testid: "kosync-replace-dialog",
            title,
            body,
            action: "Generate new password",
            busy_label: "Generating\u{2026}",
        },
        busy,
        EventHandler::new(move |()| confirming.set(false)),
        EventHandler::new(move |()| on_generate.call(())),
    )
}

#[cfg(test)]
mod tests;
