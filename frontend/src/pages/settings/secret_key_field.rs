//! Admin-only "server-wide secret key" card for the settings page. One
//! parameterized component ([`SecretKeyField`] over [`SecretKeyKind`]) behind
//! both the Hardcover and Google Books keys — they differ only in labels,
//! testids, and transport. Loads the masked status on mount; the raw key never
//! comes back to the client. SSR/first-paint start unconfigured (rule 07).

use dioxus::prelude::*;
use omnibus_shared::{GoogleBooksKeyStatus, HardcoverKeyStatus};

use crate::components::credential_card::{credential_status_line, credential_status_message};
use crate::components::{
    confirm_modal_body, BusyLabel, ConfirmModal, ConfirmModalAction, ConfirmModalTone,
};
use crate::data::{server_error_message, DataError};
use crate::{data, use_server_url};

/// Which server-wide secret this card manages. `Copy` so every async handler
/// can capture it.
#[derive(Clone, Copy, PartialEq)]
pub enum SecretKeyKind {
    /// The Hardcover token behind the "Readers also enjoyed" suggestions.
    Hardcover,
    /// The Google Books key that keeps ISBN check-ins resolving past the shared
    /// anonymous quota.
    GoogleBooks,
}

/// Masked key status, normalized across the two wire types (which are
/// structurally identical) so the component works on one shape.
#[derive(Clone)]
struct KeyStatus {
    configured: bool,
    masked: Option<String>,
    source: String,
}

impl From<HardcoverKeyStatus> for KeyStatus {
    fn from(s: HardcoverKeyStatus) -> Self {
        Self {
            configured: s.configured,
            masked: s.masked,
            source: s.source,
        }
    }
}

impl From<GoogleBooksKeyStatus> for KeyStatus {
    fn from(s: GoogleBooksKeyStatus) -> Self {
        Self {
            configured: s.configured,
            masked: s.masked,
            source: s.source,
        }
    }
}

impl SecretKeyKind {
    /// Read the masked status via the matching transport.
    async fn fetch(self, url: &str) -> Result<KeyStatus, DataError> {
        match self {
            Self::Hardcover => data::get_hardcover_key(url).await.map(Into::into),
            Self::GoogleBooks => data::get_google_books_key(url).await.map(Into::into),
        }
    }

    /// Save (`Some`) or clear (`None`) the key; returns the new masked status.
    async fn save(self, url: &str, key: Option<String>) -> Result<KeyStatus, DataError> {
        match self {
            Self::Hardcover => data::set_hardcover_key(url, key).await.map(Into::into),
            Self::GoogleBooks => data::set_google_books_key(url, key).await.map(Into::into),
        }
    }

    /// Human noun used in the status messages ("Hardcover key saved.").
    fn noun(self) -> &'static str {
        match self {
            Self::Hardcover => "Hardcover",
            Self::GoogleBooks => "Google Books",
        }
    }

    /// Card heading.
    fn heading(self) -> &'static str {
        match self {
            Self::Hardcover => "Hardcover suggestions",
            Self::GoogleBooks => "Google Books lookup",
        }
    }

    /// What clearing the key stops, for the confirm dialog.
    fn clear_consequence(self) -> &'static str {
        match self {
            Self::Hardcover => {
                "\u{201c}Readers also enjoyed\u{201d} suggestions stop until a new key is saved."
            }
            Self::GoogleBooks => {
                "ISBN check-ins fall back to the shared anonymous quota, which runs out quickly."
            }
        }
    }

    /// Card subtitle.
    fn subtitle(self) -> &'static str {
        match self {
            Self::Hardcover => "Connect Hardcover to power \u{201c}Readers also enjoyed\u{201d}.",
            Self::GoogleBooks => {
                "Add a Google Books API key so ISBN check-ins keep resolving past the shared anonymous quota."
            }
        }
    }

    /// `<label>` text (also the Playwright `getByLabel` selector).
    fn label(self) -> &'static str {
        match self {
            Self::Hardcover => "Hardcover API key",
            Self::GoogleBooks => "Google Books API key",
        }
    }

    /// `<input>` id (and `<label for=…>` target).
    fn input_id(self) -> &'static str {
        match self {
            Self::Hardcover => "hardcover-key",
            Self::GoogleBooks => "google-books-key",
        }
    }

    /// `<input>` name.
    fn input_name(self) -> &'static str {
        match self {
            Self::Hardcover => "hardcover_api_key",
            Self::GoogleBooks => "google_books_api_key",
        }
    }

    /// Placeholder shown before a masked value loads.
    fn placeholder_default(self) -> &'static str {
        match self {
            Self::Hardcover => "hc_live_\u{2026}",
            Self::GoogleBooks => "AIza\u{2026}",
        }
    }

    /// testid prefix for the card and its controls; each control appends its
    /// own suffix to keep the existing selector contract exact.
    fn testid(self) -> &'static str {
        match self {
            Self::Hardcover => "hardcover",
            Self::GoogleBooks => "google-books",
        }
    }
}

/// The five signals [`SecretKeyField`] threads through its load/save/clear
/// handlers, bundled so each helper below takes one named argument instead
/// of five positional `Signal`s.
#[derive(Clone, Copy)]
struct SecretKeyFieldSignals {
    status: Signal<Option<KeyStatus>>,
    /// Set when the status read failed, so the line stops saying "Checking".
    status_failed: Signal<bool>,
    /// Bumped by "Try again" to re-run the status read.
    reload: Signal<u32>,
    key_input: Signal<String>,
    msg: Signal<Option<String>>,
    msg_is_error: Signal<bool>,
    in_flight: Signal<bool>,
}

/// Apply a save/clear outcome to the signals: on success, install the new
/// status, clear the input, and report success; on failure, report it
/// without touching the stored status. Always clears `in_flight` last.
/// `verb_infinitive` ("save"/"clear") and `verb_past` ("saved"/"cleared") are
/// both needed: the failure message would read "Failed to saved the key".
fn apply_key_write_outcome(
    mut sigs: SecretKeyFieldSignals,
    kind: SecretKeyKind,
    verb_infinitive: &str,
    verb_past: &str,
    result: Result<KeyStatus, DataError>,
) {
    match result {
        Ok(s) => {
            sigs.status.set(Some(s));
            sigs.key_input.set(String::new());
            sigs.msg
                .set(Some(format!("{} key {verb_past}.", kind.noun())));
            sigs.msg_is_error.set(false);
        }
        Err(e) => {
            sigs.msg.set(Some(format!(
                "Couldn\u{2019}t {verb_infinitive} the {} key: {}",
                kind.noun(),
                server_error_message(&e)
            )));
            sigs.msg_is_error.set(true);
        }
    }
    sigs.in_flight.set(false);
}

/// Save handler body: empty input is a no-op with a hint — clearing is the
/// "Clear" button's job, so this never silently wipes the key and reports
/// "saved".
async fn save_key(kind: SecretKeyKind, url: String, mut sigs: SecretKeyFieldSignals) {
    if (sigs.in_flight)() || (sigs.status)().is_none() {
        return;
    }
    let value = (sigs.key_input)().trim().to_string();
    if value.is_empty() {
        sigs.msg
            .set(Some(format!("Enter a {} key to save.", kind.noun())));
        sigs.msg_is_error.set(true);
        return;
    }
    sigs.in_flight.set(true);
    let result = kind.save(&url, Some(value)).await;
    apply_key_write_outcome(sigs, kind, "save", "saved", result);
}

/// Confirmed Clear handler body; closes the confirm dialog either way.
async fn clear_key(
    kind: SecretKeyKind,
    url: String,
    mut sigs: SecretKeyFieldSignals,
    mut confirm_clear: Signal<bool>,
) {
    if (sigs.in_flight)() {
        return;
    }
    sigs.in_flight.set(true);
    let result = kind.save(&url, None).await;
    apply_key_write_outcome(sigs, kind, "clear", "cleared", result);
    confirm_clear.set(false);
}

/// Display-ready fields derived from the loaded [`KeyStatus`] (or its
/// absence before the mount-time fetch resolves).
struct SecretKeyFieldView {
    configured: bool,
    /// `None` until the status read answers.
    known: Option<bool>,
    placeholder: String,
    detail: String,
}

impl SecretKeyFieldView {
    fn from_status(st: &Option<KeyStatus>, kind: SecretKeyKind) -> Self {
        let known = st.as_ref().map(|s| s.configured);
        let configured = known.unwrap_or(false);
        let placeholder = st
            .as_ref()
            .and_then(|s| s.masked.clone())
            .unwrap_or_else(|| kind.placeholder_default().to_string());
        let detail = st
            .as_ref()
            .map(|s| {
                format!(
                    "Connected \u{00b7} {} \u{00b7} {}",
                    s.source,
                    s.masked.clone().unwrap_or_default()
                )
            })
            .unwrap_or_default();
        Self {
            configured,
            known,
            placeholder,
            detail,
        }
    }
}

/// Load the masked key status on mount; the raw key is never read back to
/// the client.
fn use_load_key_status(kind: SecretKeyKind, server_url: String, sigs: SecretKeyFieldSignals) {
    let SecretKeyFieldSignals {
        mut status,
        mut status_failed,
        reload,
        mut msg,
        mut msg_is_error,
        ..
    } = sigs;
    use_effect(move || {
        let _ = reload();
        if *status_failed.peek() {
            status_failed.set(false);
            msg.set(None);
        }
        let url = server_url.clone();
        spawn(async move {
            match kind.fetch(&url).await {
                Ok(s) => status.set(Some(s)),
                // Said aloud, or the status line would check in silence.
                Err(e) => {
                    status_failed.set(true);
                    msg.set(Some(format!(
                        "Couldn\u{2019}t read the current status: {}",
                        server_error_message(&e)
                    )));
                    msg_is_error.set(true);
                }
            }
        });
    });
}

/// Admin field to set/clear one server-wide secret key. Loads the masked status
/// on mount; the raw key is never read back to the client.
#[component]
pub fn SecretKeyField(kind: SecretKeyKind) -> Element {
    let server_url = use_server_url();
    let sigs = SecretKeyFieldSignals {
        status: use_signal(|| None),
        status_failed: use_signal(|| false),
        reload: use_signal(|| 0u32),
        key_input: use_signal(String::new),
        msg: use_signal(|| None::<String>),
        msg_is_error: use_signal(|| false),
        in_flight: use_signal(|| false),
    };
    let mut key_input = sigs.key_input;
    use_load_key_status(kind, server_url.clone(), sigs);

    let mut confirm_clear = use_signal(|| false);
    let mut reload = sigs.reload;
    let save_url = server_url.clone();
    let on_save = move |evt: FormEvent| {
        evt.prevent_default();
        spawn(save_key(kind, save_url.clone(), sigs));
    };
    let clear_url = server_url.clone();
    let on_clear = move |()| {
        spawn(clear_key(kind, clear_url.clone(), sigs, confirm_clear));
    };

    let SecretKeyFieldView {
        configured,
        known,
        placeholder,
        detail,
    } = SecretKeyFieldView::from_status(&(sigs.status)(), kind);
    let testid = kind.testid();
    let msg = sigs.msg;
    let msg_is_error = sigs.msg_is_error;
    let busy = (sigs.in_flight)();

    rsx! {
        section { class: "card", "data-testid": "{testid}-key-card",
            h3 { "{kind.heading()}" }
            p { class: "subtitle", "{kind.subtitle()}" }
            form { class: "settings-form", onsubmit: on_save,
            div { class: "settings-field",
                label { r#for: kind.input_id(), "{kind.label()}" }
                input {
                    r#type: "password",
                    id: kind.input_id(),
                    name: kind.input_name(),
                    // Server-wide secret: keep password managers / autofill /
                    // spellcheck from storing or mangling it.
                    autocomplete: "off",
                    autocapitalize: "none",
                    autocorrect: "off",
                    spellcheck: "false",
                    placeholder: "{placeholder}",
                    value: "{key_input}",
                    oninput: move |e| key_input.set(e.value()),
                }
            }
            div { class: "settings-actions",
                if configured {
                    button {
                        r#type: "button",
                        class: "btn ghost danger settings-action-start",
                        disabled: busy,
                        "data-testid": "{testid}-clear",
                        onclick: move |_| confirm_clear.set(true),
                        "Clear\u{2026}"
                    }
                }
                if (sigs.status_failed)() {
                    button {
                        r#type: "button",
                        class: "btn ghost",
                        "data-testid": "{testid}-retry",
                        onclick: move |_| reload += 1,
                        "Try again"
                    }
                }
                button {
                    r#type: "submit",
                    class: "btn primary",
                    disabled: busy || known.is_none(),
                    "aria-busy": if busy { "true" } else { "false" },
                    "data-testid": "{testid}-save",
                    BusyLabel { busy, label: format!("Save {} key", kind.noun()), busy_label: "Saving\u{2026}" }
                }
            }
            {credential_status_line(&format!("{testid}-status"), known, (sigs.status_failed)(), &detail, "Not connected")}
            {credential_status_message(&format!("{testid}-key-status"), msg().as_deref(), msg_is_error())}
            }
            if confirm_clear() {
                ClearCredentialModal {
                    testid,
                    title: format!("Remove the {} key?", kind.noun()),
                    body: format!(
                        "{} The key can\u{2019}t be shown again, so you\u{2019}ll need the original to put it back.",
                        kind.clear_consequence()
                    ),
                    confirm_label: format!("Remove {} key", kind.noun()),
                    busy,
                    on_confirm: on_clear,
                    on_cancel: move |()| confirm_clear.set(false),
                }
            }
        }
    }
}

/// Confirm before a server-wide credential goes: names what is cleared and what
/// stops working, since a cleared secret can't be read back to restore it.
/// Testids hang off `testid`: `{testid}-clear-modal`, `-clear-cancel`,
/// `-clear-confirm`.
#[component]
pub(super) fn ClearCredentialModal(
    testid: &'static str,
    #[props(into)] title: String,
    #[props(into)] body: String,
    #[props(into)] confirm_label: String,
    busy: bool,
    on_confirm: EventHandler<()>,
    on_cancel: EventHandler<()>,
) -> Element {
    rsx! {
        ConfirmModal {
            testid: format!("{testid}-clear-modal"),
            aria_label: title.clone(),
            dialog_class: "mg-modal del-modal".to_string(),
            busy,
            focus_on_open: true,
            on_dismiss: move |_| on_cancel.call(()),
            {confirm_modal_body(
                &title,
                &body,
                None,
                vec![
                    ConfirmModalAction {
                        testid: format!("{testid}-clear-cancel"),
                        label: "Keep it".to_string(),
                        busy_label: None,
                        busy: false,
                        tone: ConfirmModalTone::Ghost,
                        disabled: busy,
                        on_click: EventHandler::new(move |_| on_cancel.call(())),
                    },
                    ConfirmModalAction {
                        testid: format!("{testid}-clear-confirm"),
                        label: confirm_label,
                        busy_label: Some("Clearing\u{2026}".to_string()),
                        busy,
                        tone: ConfirmModalTone::Danger,
                        disabled: busy,
                        on_click: EventHandler::new(move |_| on_confirm.call(())),
                    },
                ],
            )}
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
