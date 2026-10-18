//! Admin-only SMTP relay config card for the settings page.
//!
//! Backs Send-to-Kindle: loads the masked config on mount, saves/clears the
//! stored secret, and fires a test email. The password is never read back to
//! the client; a blank password on Save preserves the stored secret.

use dioxus::prelude::*;
use omnibus_shared::{SmtpConfigStatus, SmtpConfigUpdate, SmtpSecurity};

use super::secret_key_field::ClearCredentialModal;
use crate::components::credential_card::{credential_status_line, credential_status_message};
use crate::components::BusyLabel;
use crate::data::server_error_message;
use crate::{data, use_server_url};

const SMTP_NOT_LOADED: &str =
    "The current SMTP settings haven\u{2019}t loaded, so saving now would overwrite them.";

/// Admin field to configure the server-wide SMTP relay used by
/// Send-to-Kindle. Loads the masked status on mount; the password is never read
/// back to the client. A blank password on Save preserves the stored secret.
#[component]
pub fn SmtpConfigField() -> Element {
    let server_url = use_server_url();
    let fields = SmtpFields {
        host: use_signal(String::new),
        port: use_signal(|| "587".to_string()),
        username: use_signal(String::new),
        from_email: use_signal(String::new),
        password: use_signal(String::new),
        security: use_signal(|| SmtpSecurity::Starttls),
    };
    let io = SmtpIo {
        status: use_signal(|| None),
        status_failed: use_signal(|| false),
        reload: use_signal(|| 0u32),
        msg: use_signal(|| None),
        msg_is_error: use_signal(|| false),
        in_flight: use_signal(|| false),
    };

    spawn_smtp_config_load(server_url.clone(), fields, io);

    let mut confirm_clear = use_signal(|| false);
    let on_save = make_smtp_save(server_url.clone(), fields, io);
    let mut on_clear = make_smtp_clear(server_url.clone(), fields, io, confirm_clear);
    let on_test = make_smtp_test(server_url, io);

    let st = (io.status)();
    let configured = st.as_ref().map(|s| s.configured).unwrap_or(false);

    rsx! {
        section { class: "card", "data-testid": "smtp-card",
            h3 { "Email delivery (SMTP)" }
            p { class: "subtitle", "The mail relay Send-to-Kindle sends books through." }
            form { class: "settings-form", onsubmit: on_save,
                SmtpConnectionFields { fields, configured }
                SmtpTestActions {
                    configured,
                    in_flight: io.in_flight,
                    status: st,
                    message: SmtpStatusMessage {
                        msg: io.msg,
                        msg_is_error: io.msg_is_error,
                        status_failed: io.status_failed,
                        reload: io.reload,
                    },
                    actions: SmtpActionHandlers {
                        on_test: EventHandler::new(on_test),
                        on_clear: EventHandler::new(move |_| confirm_clear.set(true)),
                    },
                }
            }
            if confirm_clear() {
                ClearCredentialModal {
                    testid: "smtp-clear",
                    title: "Clear the SMTP settings?",
                    body: "This removes the relay host, sign-in and stored password. Send-to-Kindle stops working until the relay is set up again.",
                    confirm_label: "Clear SMTP settings",
                    busy: (io.in_flight)(),
                    on_confirm: move |()| on_clear(()),
                    on_cancel: move |()| confirm_clear.set(false),
                }
            }
        }
    }
}

/// Editable SMTP connection signals threaded into the connection fields.
#[derive(Copy, Clone, PartialEq)]
struct SmtpFields {
    host: Signal<String>,
    port: Signal<String>,
    username: Signal<String>,
    from_email: Signal<String>,
    password: Signal<String>,
    security: Signal<SmtpSecurity>,
}

/// Loaded status + save/test message + in-flight signals for the SMTP card.
#[derive(Copy, Clone, PartialEq)]
struct SmtpIo {
    status: Signal<Option<SmtpConfigStatus>>,
    /// Set when the config read failed, so the line stops saying "Checking".
    status_failed: Signal<bool>,
    /// Bumped by "Try again" to re-run the config read.
    reload: Signal<u32>,
    msg: Signal<Option<String>>,
    msg_is_error: Signal<bool>,
    in_flight: Signal<bool>,
}

/// Load the masked SMTP config on mount and seed the editable fields.
fn spawn_smtp_config_load(server_url: String, fields: SmtpFields, io: SmtpIo) {
    let SmtpIo {
        mut status,
        mut status_failed,
        reload,
        mut msg,
        mut msg_is_error,
        ..
    } = io;
    let mut host = fields.host;
    let mut port = fields.port;
    let mut username = fields.username;
    let mut from_email = fields.from_email;
    let mut security = fields.security;
    use_effect(move || {
        let _ = reload();
        if *status_failed.peek() {
            status_failed.set(false);
            msg.set(None);
        }
        let url = server_url.clone();
        spawn(async move {
            let s = match data::get_smtp_config(&url).await {
                Ok(s) => s,
                // Said aloud, or the status line would check in silence.
                Err(e) => {
                    status_failed.set(true);
                    msg.set(Some(format!(
                        "Couldn\u{2019}t read the current settings: {}",
                        server_error_message(&e)
                    )));
                    msg_is_error.set(true);
                    return;
                }
            };
            if let Some(h) = s.host.clone() {
                host.set(h);
            }
            if let Some(p) = s.port {
                port.set(p.to_string());
            }
            if let Some(u) = s.username.clone() {
                username.set(u);
            }
            if let Some(f) = s.from_email.clone() {
                from_email.set(f);
            }
            security.set(s.security);
            status.set(Some(s));
        });
    });
}

/// Build the Save handler: refuse until the current config has loaded (the
/// seeded blanks would overwrite it), validate the port, then POST the update.
fn make_smtp_save(server_url: String, fields: SmtpFields, io: SmtpIo) -> impl FnMut(FormEvent) {
    let host = fields.host;
    let port = fields.port;
    let username = fields.username;
    let from_email = fields.from_email;
    let mut password = fields.password;
    let security = fields.security;
    let mut status = io.status;
    let mut msg = io.msg;
    let mut msg_is_error = io.msg_is_error;
    let mut in_flight = io.in_flight;
    move |evt: FormEvent| {
        evt.prevent_default();
        if in_flight() {
            return;
        }
        if status().is_none() {
            msg.set(Some(SMTP_NOT_LOADED.to_string()));
            msg_is_error.set(true);
            return;
        }
        let host_val = host().trim().to_string();
        // `parse::<u16>()` accepts 0, but 0 is not a usable port — reject it
        // so the UI matches the "1 and 65535" message (and the DB validator).
        let port_val = match port().trim().parse::<u16>() {
            Ok(p) if p != 0 => p,
            _ => {
                msg.set(Some(
                    "Port must be a number between 1 and 65535.".to_string(),
                ));
                msg_is_error.set(true);
                return;
            }
        };
        // A blank password field means "leave the stored secret unchanged".
        let pw = password();
        let password_val = if pw.is_empty() { None } else { Some(pw) };
        let update = SmtpConfigUpdate {
            host: host_val,
            port: port_val,
            username: username().trim().to_string(),
            from_email: from_email().trim().to_string(),
            security: security(),
            password: password_val,
        };
        let url = server_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::set_smtp_config(&url, update).await {
                Ok(s) => {
                    status.set(Some(s));
                    password.set(String::new());
                    msg.set(Some("SMTP settings saved.".to_string()));
                    msg_is_error.set(false);
                }
                Err(e) => {
                    msg.set(Some(format!(
                        "Couldn\u{2019}t save the SMTP settings: {}",
                        server_error_message(&e)
                    )));
                    msg_is_error.set(true);
                }
            }
            in_flight.set(false);
        });
    }
}

/// Build the confirmed Clear handler: wipe the stored config, reset the fields,
/// and close the confirm dialog either way.
fn make_smtp_clear(
    server_url: String,
    fields: SmtpFields,
    io: SmtpIo,
    mut confirm_clear: Signal<bool>,
) -> impl FnMut(()) {
    let mut host = fields.host;
    let mut port = fields.port;
    let mut username = fields.username;
    let mut from_email = fields.from_email;
    let mut password = fields.password;
    let mut security = fields.security;
    let mut status = io.status;
    let mut msg = io.msg;
    let mut msg_is_error = io.msg_is_error;
    let mut in_flight = io.in_flight;
    move |()| {
        if in_flight() {
            return;
        }
        let url = server_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::clear_smtp_config(&url).await {
                Ok(s) => {
                    host.set(String::new());
                    port.set("587".to_string());
                    username.set(String::new());
                    from_email.set(String::new());
                    password.set(String::new());
                    security.set(SmtpSecurity::Starttls);
                    status.set(Some(s));
                    msg.set(Some("SMTP settings cleared.".to_string()));
                    msg_is_error.set(false);
                }
                Err(e) => {
                    msg.set(Some(format!(
                        "Couldn\u{2019}t clear the SMTP settings: {}",
                        server_error_message(&e)
                    )));
                    msg_is_error.set(true);
                }
            }
            in_flight.set(false);
            confirm_clear.set(false);
        });
    }
}

/// Build the Send-Test handler: fire a test email via the configured relay.
fn make_smtp_test(server_url: String, io: SmtpIo) -> impl FnMut(MouseEvent) {
    let mut msg = io.msg;
    let mut msg_is_error = io.msg_is_error;
    let mut in_flight = io.in_flight;
    move |_| {
        let url = server_url.clone();
        in_flight.set(true);
        spawn(async move {
            match data::send_smtp_test(&url).await {
                Ok(()) => {
                    msg.set(Some("Test email sent to your Kindle address.".to_string()));
                    msg_is_error.set(false);
                }
                Err(_) => {
                    msg.set(Some(
                        "Test email failed — check the SMTP settings and your account's Kindle email."
                            .to_string(),
                    ));
                    msg_is_error.set(true);
                }
            }
            in_flight.set(false);
        });
    }
}

/// Host / port / security / username / password / from-email inputs.
#[component]
fn SmtpConnectionFields(fields: SmtpFields, configured: bool) -> Element {
    let mut host = fields.host;
    let mut port = fields.port;
    let mut username = fields.username;
    let mut from_email = fields.from_email;
    let mut password = fields.password;
    let mut security = fields.security;
    rsx! {
        div { class: "settings-field",
            label { r#for: "smtp-host", "SMTP host" }
            input {
                r#type: "text",
                id: "smtp-host",
                name: "smtp_host",
                autocomplete: "off",
                autocapitalize: "none",
                spellcheck: "false",
                translate: "no",
                placeholder: "smtp.example.com\u{2026}",
                value: "{host}",
                oninput: move |e| host.set(e.value()),
            }
        }
        div { class: "settings-field",
            label { r#for: "smtp-port", "Port" }
            input {
                r#type: "number",
                id: "smtp-port",
                name: "smtp_port",
                inputmode: "numeric",
                min: "1",
                max: "65535",
                value: "{port}",
                oninput: move |e| port.set(e.value()),
            }
        }
        div { class: "settings-field",
            label { r#for: "smtp-security", "Security" }
            select {
                id: "smtp-security",
                name: "smtp_security",
                "data-testid": "smtp-security",
                value: "{security().as_str()}",
                onchange: move |e| security.set(SmtpSecurity::from_str_or_default(&e.value())),
                option { value: "starttls", "STARTTLS (587)" }
                option { value: "tls", "TLS (465)" }
            }
        }
        div { class: "settings-field",
            label { r#for: "smtp-username", "Username" }
            input {
                r#type: "text",
                id: "smtp-username",
                name: "smtp_username",
                autocomplete: "off",
                autocapitalize: "none",
                spellcheck: "false",
                value: "{username}",
                oninput: move |e| username.set(e.value()),
            }
        }
        div { class: "settings-field",
            label { r#for: "smtp-password", "Password" }
            input {
                r#type: "password",
                id: "smtp-password",
                name: "smtp_password",
                autocomplete: "off",
                autocapitalize: "none",
                autocorrect: "off",
                spellcheck: "false",
                placeholder: if configured { "\u{2022}\u{2022}\u{2022}\u{2022} (unchanged)" } else { "" },
                value: "{password}",
                oninput: move |e| password.set(e.value()),
            }
        }
        div { class: "settings-field",
            label { r#for: "smtp-from", "From address" }
            input {
                r#type: "email",
                id: "smtp-from",
                name: "smtp_from_email",
                autocomplete: "off",
                spellcheck: "false",
                placeholder: "library@example.com\u{2026}",
                value: "{from_email}",
                oninput: move |e| from_email.set(e.value()),
            }
        }
    }
}

/// Save/test status-line signals. Grouped so [`SmtpTestActions`] stays under
/// the prop cap.
#[derive(Copy, Clone, PartialEq)]
struct SmtpStatusMessage {
    msg: Signal<Option<String>>,
    msg_is_error: Signal<bool>,
    status_failed: Signal<bool>,
    reload: Signal<u32>,
}

/// Send-test / clear handlers (Save is the form's submit). Grouped so
/// [`SmtpTestActions`] stays under the prop cap.
#[derive(Copy, Clone, PartialEq)]
struct SmtpActionHandlers {
    on_test: EventHandler<MouseEvent>,
    on_clear: EventHandler<MouseEvent>,
}

/// Save / send-test / clear buttons, the configured-state line, and the
/// save/test status message. Save waits for the current config to load, and a
/// failed read offers Try again.
#[component]
fn SmtpTestActions(
    configured: bool,
    in_flight: Signal<bool>,
    status: Option<SmtpConfigStatus>,
    message: SmtpStatusMessage,
    actions: SmtpActionHandlers,
) -> Element {
    let SmtpStatusMessage {
        msg,
        msg_is_error,
        status_failed,
        mut reload,
    } = message;
    let SmtpActionHandlers { on_test, on_clear } = actions;
    let loaded = status.is_some();
    let busy = in_flight();
    let detail = status
        .as_ref()
        .map(|s| format!("Configured \u{00b7} {}", s.source))
        .unwrap_or_default();
    rsx! {
        div { class: "settings-actions",
            {credential_status_line("smtp-status", status.as_ref().map(|s| s.configured), status_failed(), &detail, "Not configured")}
            if configured {
                button {
                    r#type: "button",
                    class: "btn ghost danger",
                    disabled: busy,
                    "data-testid": "smtp-clear",
                    onclick: move |e| on_clear.call(e),
                    "Clear\u{2026}"
                }
            }
            if status_failed() {
                button {
                    r#type: "button",
                    class: "btn ghost",
                    "data-testid": "smtp-retry",
                    onclick: move |_| reload += 1,
                    "Try again"
                }
            }
            if configured {
                button {
                    r#type: "button",
                    class: "btn ghost",
                    disabled: busy,
                    "data-testid": "smtp-test",
                    onclick: move |e| on_test.call(e),
                    "Send test email"
                }
            }
            button {
                r#type: "submit",
                class: "btn primary",
                disabled: busy || !loaded,
                "aria-busy": if busy { "true" } else { "false" },
                "data-testid": "smtp-save",
                BusyLabel { busy, label: "Save SMTP settings", busy_label: "Saving\u{2026}" }
            }
        }
        {credential_status_message("smtp-config-status", msg().as_deref(), msg_is_error())}
    }
}

#[cfg(test)]
mod tests;
