//! Send-to-Kindle destination card (Settings › Devices): the saved address,
//! hydrated from `/api/auth/me` after mount, with save/clear round-tripping
//! through `data::set_kindle_email`, and whether this server can deliver at
//! all — with the sender address the reader must approve at Amazon. Until
//! each read answers, its line checks rather than guessing.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::KindleDelivery;

use crate::components::clipboard::CopyButton;
use crate::components::confirm_modal::{confirm_dialog, Confirm};
use crate::components::credential_card::live_status;
use crate::components::unsaved::use_unsaved_guard;
use crate::components::{BusyLabel, Loading, LoadingKind};
use crate::{data, use_server_url, Access, Route};

/// Signals backing the Kindle email form — grouped so the hydration effect
/// and the save/clear handler builders don't each take five signal params.
#[derive(Clone, Copy)]
struct KindleEmailSignals {
    email_input: Signal<String>,
    saved_email: Signal<Option<String>>,
    /// `None` while the saved address is being read; then whether the read
    /// succeeded — until it has, "none configured" would be a guess.
    hydrated: Signal<Option<bool>>,
    msg: Signal<Option<String>>,
    msg_is_error: Signal<bool>,
    in_flight: Signal<bool>,
    /// Clear's confirm is open.
    confirm_clear: Signal<bool>,
}

/// Reads whether the server can deliver after mount: `None` while asking,
/// `Some(None)` once the read has failed.
fn use_kindle_delivery(server_url: String) -> Signal<Option<Option<KindleDelivery>>> {
    let mut delivery = use_signal(|| None);
    use_effect(move || {
        let url = server_url.clone();
        spawn(async move {
            delivery.set(Some(data::kindle_delivery(&url).await.ok()));
        });
    });
    delivery
}

/// Hydrates the saved Kindle email after mount. `current_user` is a no-op on
/// SSR/mobile, so the first paint matches the empty-signal SSR markup.
fn use_kindle_email_hydration(mut signals: KindleEmailSignals) {
    use_effect(move || {
        spawn(async move {
            let result = data::current_user().await;
            if let Ok(Some(user)) = &result {
                if let Some(email) = user.kindle_email.clone() {
                    signals.email_input.set(email.clone());
                    signals.saved_email.set(Some(email));
                }
            }
            signals.hydrated.set(Some(result.is_ok()));
        });
    });
}

/// Submit handler for the Kindle email save form: validates non-empty
/// locally, then round-trips through `data::set_kindle_email`.
fn kindle_save_handler(
    server_url: String,
    mut signals: KindleEmailSignals,
) -> impl FnMut(Event<FormData>) + 'static {
    move |evt: Event<FormData>| {
        evt.prevent_default();
        let value = (signals.email_input)().trim().to_string();
        if value.is_empty() {
            signals
                .msg
                .set(Some("Enter a Kindle email to save.".to_string()));
            signals.msg_is_error.set(true);
            return;
        }
        let url = server_url.clone();
        signals.in_flight.set(true);
        spawn(async move {
            match data::set_kindle_email(&url, Some(value.clone())).await {
                Ok(()) => {
                    signals.saved_email.set(Some(value));
                    signals.msg.set(Some("Kindle email saved.".to_string()));
                    signals.msg_is_error.set(false);
                }
                Err(_) => {
                    signals.msg.set(Some(
                        "Failed to save Kindle email — check the address.".to_string(),
                    ));
                    signals.msg_is_error.set(true);
                }
            }
            signals.in_flight.set(false);
        });
    }
}

/// What Clear's confirm says: the address it removes, and what stops.
fn kindle_clear_warning(address: &str) -> String {
    format!("Send to Kindle stops delivering to {address} until you save an address again.")
}

/// The confirmed clear: remove the saved address, then close the confirm.
fn kindle_clear_handler(
    server_url: String,
    mut signals: KindleEmailSignals,
) -> impl FnMut(()) + 'static {
    move |()| {
        let url = server_url.clone();
        signals.in_flight.set(true);
        spawn(async move {
            match data::set_kindle_email(&url, None).await {
                Ok(()) => {
                    signals.email_input.set(String::new());
                    signals.saved_email.set(None);
                    signals.msg.set(Some("Kindle email cleared.".to_string()));
                    signals.msg_is_error.set(false);
                }
                Err(_) => {
                    signals
                        .msg
                        .set(Some("Failed to clear Kindle email.".to_string()));
                    signals.msg_is_error.set(true);
                }
            }
            signals.in_flight.set(false);
            signals.confirm_clear.set(false);
        });
    }
}

/// The Kindle email form: input and save/clear actions. Split out of `kindle_account_body` so the signal wiring above and
/// this markup each stay readable on their own.
fn kindle_email_form(
    email_input: Signal<String>,
    in_flight: Signal<bool>,
    connected: bool,
    on_save: impl FnMut(Event<FormData>) + 'static,
    on_clear: impl FnMut(Event<MouseData>) + 'static,
) -> Element {
    let mut email_input = email_input;
    rsx! {
        form {
            id: "kindle-email-form",
            class: "settings-form",
            onsubmit: on_save,
            div { class: "settings-field",
                label { r#for: "kindle-email", "Kindle email" }
                input {
                    r#type: "email",
                    id: "kindle-email",
                    name: "kindle_email",
                    "data-testid": "kindle-email-input",
                    autocomplete: "off",
                    autocapitalize: "none",
                    autocorrect: "off",
                    spellcheck: "false",
                    placeholder: "you@kindle.com",
                    value: "{email_input}",
                    oninput: move |e| email_input.set(e.value()),
                }
            }
            div { class: "settings-actions",
                if connected {
                    button {
                        r#type: "button",
                        class: "btn ghost danger settings-action-start",
                        disabled: in_flight(),
                        "data-testid": "kindle-email-clear",
                        onclick: on_clear,
                        "Clear"
                    }
                }
                button {
                    r#type: "submit",
                    class: "btn primary",
                    disabled: in_flight(),
                    "aria-busy": "{in_flight()}",
                    "data-testid": "kindle-email-save",
                    BusyLabel { busy: in_flight(), label: "Save Kindle email", busy_label: "Saving\u{2026}" }
                }
            }
        }
    }
}

/// The Send-to-Kindle destination card (Settings › Devices). Hydrates the
/// saved address from `/api/auth/me`; saving/clearing round-trips through
/// `data::set_kindle_email`.
#[component]
pub(crate) fn KindleEmailCard() -> Element {
    let server_url = use_server_url();
    let delivery = use_kindle_delivery(server_url.clone());
    let access = crate::use_admin_access();
    let signals = KindleEmailSignals {
        email_input: use_signal(String::new),
        saved_email: use_signal(|| None::<String>),
        hydrated: use_signal(|| None::<bool>),
        msg: use_signal(|| None::<String>),
        msg_is_error: use_signal(|| false),
        in_flight: use_signal(|| false),
        confirm_clear: use_signal(|| false),
    };
    use_kindle_email_hydration(signals);
    let edited = use_memo(move || {
        (signals.hydrated)() == Some(true)
            && (signals.email_input)().trim() != (signals.saved_email)().unwrap_or_default()
    });
    use_unsaved_guard("kindle-email", edited);

    let on_save = kindle_save_handler(server_url.clone(), signals);
    let on_clear = kindle_clear_handler(server_url, signals);
    let mut confirm_clear = signals.confirm_clear;
    let saved_email = (signals.saved_email)();
    let connected = saved_email.is_some();

    rsx! {
        section { class: "card", "data-testid": "account-kindle-card",
            h3 { "Kindle" }
            p { class: "subtitle", "The address Send to Kindle delivers your books to." }

            {kindle_email_form(signals.email_input, signals.in_flight, connected, on_save, move |_| confirm_clear.set(true))}

            {kindle_connected_line(connected, (signals.hydrated)())}

            {kindle_delivery_line(delivery(), access())}

            {live_status("kindle-email-status", (signals.msg)().as_deref(), (signals.msg_is_error)())}
        }
        if let Some(address) = saved_email.filter(|_| confirm_clear()) {
            {confirm_dialog(
                Confirm {
                    testid: "kindle-email-clear-dialog",
                    title: "Clear your Kindle email?",
                    body: &kindle_clear_warning(&address),
                    action: "Clear Kindle email",
                    busy_label: "Clearing\u{2026}",
                },
                (signals.in_flight)(),
                EventHandler::new(move |()| confirm_clear.set(false)),
                EventHandler::new(on_clear),
            )}
        }
    }
}

/// Whether an address is on file — a sheen while the read is out, since
/// "none configured" before it answers would be a guess.
fn kindle_connected_line(connected: bool, hydrated: Option<bool>) -> Element {
    let (class, text) = match (hydrated, connected) {
        (_, true) => ("settings-status success", "A Kindle email is configured."),
        (Some(true), false) => ("settings-status", "No Kindle email configured yet."),
        (Some(false), false) => (
            "settings-status",
            "Couldn\u{2019}t check for a saved Kindle email.",
        ),
        (None, false) => ("settings-status is-pending", ""),
    };
    rsx! {
        p { class, "data-testid": "kindle-email-connected",
            if text.is_empty() {
                span { class: "ld-sheen", "Checking for a saved address" }
            } else {
                "{text}"
            }
        }
    }
}

/// Whether this server can deliver at all. Ready names the sender to approve
/// at Amazon; not set up says who can fix it, which waits on the reader's role.
fn kindle_delivery_line(delivery: Option<Option<KindleDelivery>>, access: Access) -> Element {
    let checking = rsx! {
        Loading {
            kind: LoadingKind::Section,
            class: "start",
            testid: "kindle-delivery-loading",
            label: "Checking email delivery\u{2026}",
        }
    };
    let Some(answer) = delivery else {
        return checking;
    };
    let Some(delivery) = answer else {
        return rsx! {
            p { class: "subtitle", "data-testid": "kindle-delivery",
                "Couldn\u{2019}t check whether email delivery is set up on this server. Either way, add "
                "the library\u{2019}s sender address to your Amazon "
                a {
                    href: "https://www.amazon.com/sendtokindle/email",
                    target: "_blank",
                    rel: "noopener",
                    "approved sender list"
                }
                " or Amazon drops the delivery."
            }
        };
    };
    if let Some(sender) = delivery.sender_address {
        return rsx! {
            div { class: "kindle-delivery", "data-testid": "kindle-delivery",
                p { class: "subtitle",
                    "Approve "
                    code { translate: "no", "{sender}" }
                    " in your Amazon account\u{2019}s "
                    a {
                        href: "https://www.amazon.com/sendtokindle/email",
                        target: "_blank",
                        rel: "noopener",
                        "approved senders"
                    }
                    ", or Amazon drops the delivery."
                }
                CopyButton {
                    text: sender.clone(),
                    label: "Copy address",
                    testid: "kindle-sender-copy",
                    aria_label: "Copy sender address",
                }
            }
        };
    }
    match access {
        Access::Unknown => checking,
        Access::Allowed => rsx! {
            p { class: "subtitle", "data-testid": "kindle-delivery",
                "Email delivery isn\u{2019}t set up on this server yet. "
                Link {
                    to: crate::routes::link_target(Route::Admin {
                        section: Some("integrations".to_string()),
                    }),
                    "Set up email delivery"
                }
            }
        },
        Access::Denied => rsx! {
            p { class: "subtitle", "data-testid": "kindle-delivery",
                "Email delivery isn\u{2019}t set up on this server \u{2014} ask your administrator."
            }
        },
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
