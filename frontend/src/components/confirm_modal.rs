//! Shared confirm-modal shell: the backdrop-dismiss / click-through-safe
//! panel wrapper duplicated across the merge, delete, author-photo, and
//! physical-copy dialogs, plus a title/body/action-row body for the common
//! "confirm one thing" case.

use dioxus::prelude::*;

use crate::components::BusyLabel;

/// Visual weight of one [`ConfirmModalAction`] button.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ConfirmModalTone {
    Ghost,
    Danger,
}

/// One button in a [`confirm_modal_body`] action row.
///
/// `busy_label` makes this an action that can work: while `busy`, it shows
/// that label with a ring in place of `label` and reports `aria-busy`. `busy`
/// is its own field — a button disabled for any other reason is not working.
#[derive(Clone, PartialEq)]
pub struct ConfirmModalAction {
    pub testid: String,
    pub label: String,
    pub busy_label: Option<String>,
    pub busy: bool,
    pub tone: ConfirmModalTone,
    pub disabled: bool,
    pub on_click: EventHandler<()>,
}

/// Forward to `on_dismiss` unless a mutation is in flight — the shared
/// backdrop-dismiss gate every modal call site relies on. Split out from the
/// backdrop's `onclick` so the branch is directly unit-testable without a
/// simulated click.
fn dismiss_unless_busy(busy: bool, on_dismiss: EventHandler<()>) {
    if !busy {
        on_dismiss.call(());
    }
}

/// Modal backdrop + panel shell shared by every dialog: a backdrop click
/// dismisses (unless `busy`), a click inside the panel does not bubble to it.
/// `children` is the body, `head` an optional title/close slot, `backdrop_class`
/// overrides the default chrome. Escape dismisses on the same gate; `focus_on_open`
/// focuses the panel for it, so leave it off when the body autofocuses a field.
#[component]
pub fn ConfirmModal(
    testid: String,
    aria_label: String,
    #[props(default = "author-photo-modal-backdrop".to_string())] backdrop_class: String,
    dialog_class: String,
    busy: bool,
    on_dismiss: EventHandler<()>,
    // Raw `Element`, not a `title: String`: callers differ in heading tag and
    // class, and one shape would change their rendered markup.
    #[props(default)] head: Option<Element>,
    #[props(default = false)] focus_on_open: bool,
    children: Element,
) -> Element {
    rsx! {
        div {
            class: "{backdrop_class}",
            role: "dialog",
            aria_modal: "true",
            aria_label: "{aria_label}",
            "data-testid": "{testid}",
            onclick: move |evt| {
                evt.stop_propagation();
                dismiss_unless_busy(busy, on_dismiss);
            },
            onkeydown: move |evt: KeyboardEvent| {
                if evt.key() == Key::Escape {
                    evt.prevent_default();
                    dismiss_unless_busy(busy, on_dismiss);
                }
            },
            // Focusable so the keydown above receives Escape at all: without
            // a tabindex the wrapper is not a key-event target, and focus
            // otherwise sits on the trigger outside the modal.
            tabindex: "-1",
            onmounted: move |evt: MountedEvent| {
                if focus_on_open {
                    crate::focus_after_paint::focus_after_paint(&evt);
                }
            },
            div { class: "{dialog_class}", onclick: move |evt| evt.stop_propagation(),
                if let Some(h) = head { {h} }
                {children}
            }
        }
    }
}

/// Title + body copy + optional note + action-button row — the "confirm one
/// thing" body shape shared by the shelf, journal and physical-copy delete
/// modals. The `.del-body` wrapper carries the pane's padding, so it is
/// emitted here, not by each caller. `note` renders *above* the action row,
/// in front of the buttons that caused it.
pub fn confirm_modal_body(
    title: &str,
    body: &str,
    note: Option<Element>,
    actions: Vec<ConfirmModalAction>,
) -> Element {
    rsx! {
        div { class: "del-body",
            h3 { class: "del-title", "{title}" }
            p { class: "del-copy", "{body}" }
            if let Some(note) = note { {note} }
            div { class: "del-actions",
                for action in actions {
                    button {
                        key: "{action.testid}",
                        class: if action.tone == ConfirmModalTone::Danger { "del-btn-danger" } else { "del-btn-ghost" },
                        "data-testid": "{action.testid}",
                        disabled: action.disabled,
                        "aria-busy": if action.is_busy() { "true" } else { "false" },
                        onclick: move |_| action.on_click.call(()),
                        {action_label(&action)}
                    }
                }
            }
        }
    }
}

impl ConfirmModalAction {
    /// Whether this is the working action, mid-work.
    fn is_busy(&self) -> bool {
        self.busy && self.busy_label.is_some()
    }
}

/// An action's label: a working action swaps to its busy label in place.
fn action_label(action: &ConfirmModalAction) -> Element {
    match action.busy_label.clone() {
        Some(busy_label) => rsx! {
            BusyLabel { busy: action.is_busy(), label: action.label.clone(), busy_label }
        },
        None => rsx! { "{action.label}" },
    }
}

// Every test here renders SSR markup, so the module is `server`-gated —
// under `web` its contents would be dead code and CI lints with `-D warnings`.
#[cfg(all(test, feature = "server"))]
mod tests;
