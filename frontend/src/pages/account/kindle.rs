//! Send-to-Kindle destination card (web Settings → Kindle): the saved address,
//! hydrated from `/api/auth/me` after mount, with save/clear round-tripping
//! through `data::set_kindle_email`. Until the read answers, the status line
//! checks rather than claiming no address is configured.

use dioxus::prelude::*;

use crate::components::credential_card::credential_status_message;
use crate::{data, use_server_url};

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

/// Click handler for the Kindle email clear button.
fn kindle_clear_handler(
    server_url: String,
    mut signals: KindleEmailSignals,
) -> impl FnMut(Event<MouseData>) + 'static {
    move |_| {
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
        });
    }
}

/// The Kindle email form: input, save/clear actions, and the approved-sender
/// hint. Split out of `kindle_account_body` so the signal wiring above and
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
                label { r#for: "kindle-email", "Kindle Email" }
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
            p { class: "subtitle",
                "Add "
                b { "your library's sender address" }
                " to your Amazon "
                a {
                    href: "https://www.amazon.com/sendtokindle/email",
                    target: "_blank",
                    rel: "noopener",
                    "approved sender list"
                }
                " or Amazon will silently drop the delivery."
            }
            div { class: "settings-actions",
                button {
                    r#type: "submit",
                    class: "btn",
                    disabled: in_flight(),
                    "data-testid": "kindle-email-save",
                    "Save"
                }
                button {
                    r#type: "button",
                    class: "btn ghost",
                    disabled: in_flight() || !connected,
                    "data-testid": "kindle-email-clear",
                    onclick: on_clear,
                    "Clear"
                }
            }
        }
    }
}

/// The Send-to-Kindle destination card (Settings → Kindle). Hydrates the
/// saved address from `/api/auth/me`; saving/clearing round-trips through
/// `data::set_kindle_email`.
#[component]
pub(crate) fn KindleEmailCard() -> Element {
    let server_url = use_server_url();
    let signals = KindleEmailSignals {
        email_input: use_signal(String::new),
        saved_email: use_signal(|| None::<String>),
        hydrated: use_signal(|| None::<bool>),
        msg: use_signal(|| None::<String>),
        msg_is_error: use_signal(|| false),
        in_flight: use_signal(|| false),
    };
    use_kindle_email_hydration(signals);

    let on_save = kindle_save_handler(server_url.clone(), signals);
    let on_clear = kindle_clear_handler(server_url, signals);
    let connected = (signals.saved_email)().is_some();

    rsx! {
        section { class: "card", "data-testid": "account-kindle-card",
            h2 { "Kindle" }
            p { class: "subtitle", "Configure your Send-to-Kindle delivery address." }

            {kindle_email_form(signals.email_input, signals.in_flight, connected, on_save, on_clear)}

            {kindle_connected_line(connected, (signals.hydrated)())}

            {credential_status_message("kindle-email-status", (signals.msg)().as_deref(), (signals.msg_is_error)())}
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

#[cfg(all(test, feature = "server"))]
mod tests {
    use super::*;
    use crate::test_support::render;

    #[test]
    fn kindle_line_checks_before_claiming_no_address_is_configured() {
        let pending = render(kindle_connected_line(false, None));
        assert!(pending.contains("ld-sheen"), "{pending}");
        assert!(
            !pending.contains("No Kindle email configured yet."),
            "{pending}"
        );
        let answered = render(kindle_connected_line(false, Some(true)));
        assert!(
            answered.contains("No Kindle email configured yet."),
            "{answered}"
        );
        let failed = render(kindle_connected_line(false, Some(false)));
        assert!(
            !failed.contains("No Kindle email configured yet."),
            "{failed}"
        );
    }
}
