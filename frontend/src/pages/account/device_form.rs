//! The add-a-device form both Settings › Devices cards draw: the name field and its Add button
//! on one line, the card's own extras under them, then its status. One helper, so the Kobo and
//! KOReader cards cannot drift apart.

use dioxus::prelude::*;

use crate::components::loading::RowSkeletons;
use crate::components::BusyLabel;

/// What a card tells a reader who adds a device without naming it.
pub(super) const NAME_REQUIRED: &str = "Enter a name for your device.";

/// What differs between the two cards' forms.
pub(super) struct AddForm {
    /// `kobo` or `koreader`: the form's id and its test ids.
    pub prefix: &'static str,
    pub placeholder: &'static str,
    /// The Add button's label.
    pub label: &'static str,
    pub name_input: Signal<String>,
    pub in_flight: bool,
    /// The Add button is off for a reason besides a request in flight, such as the list not having loaded.
    pub waiting: bool,
    /// Controls under the name row, such as the KOReader card's checkbox.
    pub extra: Element,
    /// The card's result line.
    pub status: Element,
    /// Runs on Enter in the name field and on the Add button.
    pub on_submit: Callback<()>,
}

/// The name field and Add button on one line, then `extra` and `status`.
pub(super) fn render_add_form(form: AddForm) -> Element {
    let AddForm {
        prefix,
        placeholder,
        label,
        name_input,
        in_flight,
        waiting,
        extra,
        status,
        on_submit,
    } = form;
    rsx! {
        form {
            id: "{prefix}-add-form",
            class: "settings-form",
            onsubmit: move |evt: Event<FormData>| {
                evt.prevent_default();
                on_submit.call(());
            },
            div { class: "device-add-row",
                div { class: "settings-field",
                    label { id: "{prefix}-device-name-label", r#for: "{prefix}-device-name", "Device name" }
                    input {
                        r#type: "text",
                        id: "{prefix}-device-name",
                        name: "{prefix}_device_name",
                        "data-testid": "{prefix}-device-name-input",
                        // Named by its card too: both cards' fields read "Device name".
                        "aria-labelledby": "{prefix}-card-title {prefix}-device-name-label",
                        autocomplete: "off",
                        placeholder,
                        maxlength: "100",
                        value: "{name_input}",
                        oninput: move |e| { let mut name_input = name_input; name_input.set(e.value()) },
                    }
                }
                button {
                    r#type: "submit",
                    class: "btn primary",
                    disabled: in_flight || waiting,
                    "aria-busy": "{in_flight}",
                    "data-testid": "{prefix}-device-add",
                    BusyLabel { busy: in_flight, label, busy_label: "Adding\u{2026}" }
                }
            }
            {extra}
            div { class: "settings-actions", {status} }
        }
    }
}

/// The list's stand-in until the first answer: a skeleton, or nothing once the load failed (the
/// status line then says why). A refused add never hides it.
pub(super) fn render_list_loading(load_failed: bool, prefix: &str, what: &str) -> Element {
    if load_failed {
        return rsx! {};
    }
    rsx! {
        div { role: "status", "aria-live": "polite", "data-testid": "{prefix}-devices-loading",
            span { class: "ld-sr", "Finding your {what}" }
            RowSkeletons { count: 1, avatar: false }
        }
    }
}
