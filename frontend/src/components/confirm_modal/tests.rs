//! SSR render-smoke coverage for the shared modal shell and its
//! title/body/action-row body, plus direct coverage of the backdrop's
//! busy-gate logic. Needs the `server` feature (`dioxus::ssr`).

use std::cell::RefCell;
use std::rc::Rc;

use super::*;
use crate::test_support::render;

#[component]
fn Harness() -> Element {
    rsx! {
        ConfirmModal {
            testid: "sample-modal".to_string(),
            aria_label: "Sample modal".to_string(),
            dialog_class: "mg-modal confirm-modal".to_string(),
            busy: false,
            on_dismiss: move |_| {},
            {confirm_modal_body(
                "Remove this copy?",
                "This removes the physical copy from your collection.",
                None,
                vec![
                    ConfirmModalAction {
                        testid: "sample-cancel".to_string(),
                        label: "Cancel".to_string(),
                        tone: ConfirmModalTone::Ghost,
                        disabled: false,
                        on_click: EventHandler::new(|_| {}),
                    },
                    ConfirmModalAction {
                        testid: "sample-confirm".to_string(),
                        label: "I sold it".to_string(),
                        tone: ConfirmModalTone::Danger,
                        disabled: false,
                        on_click: EventHandler::new(|_| {}),
                    },
                ],
            )}
        }
    }
}

#[test]
fn confirm_modal_renders_the_backdrop_panel_title_body_and_actions() {
    let html = render(rsx! { Harness {} });
    assert!(html.contains("data-testid=\"sample-modal\""));
    assert!(html.contains("author-photo-modal-backdrop"));
    assert!(html.contains("mg-modal confirm-modal"));
    assert!(html.contains("Remove this copy?"));
    assert!(html.contains("This removes the physical copy from your collection."));
    assert!(html.contains("data-testid=\"sample-cancel\""));
    assert!(html.contains("del-btn-ghost"));
    assert!(html.contains("data-testid=\"sample-confirm\""));
    assert!(html.contains("del-btn-danger"));
}

// Regression for #2465: the stats drill sheet answered only its Close
// button, because the shell it is built on was not a key-event target.
#[test]
fn confirm_modal_shell_is_focusable_so_escape_can_reach_its_key_handler() {
    let html = render(rsx! { Harness {} });
    assert!(html.contains(r#"tabindex="-1""#), "{html}");
    assert!(html.contains(r#"role="dialog""#), "{html}");
    assert!(html.contains(r#"aria-modal="true""#), "{html}");
}

// Regression for the delete-shelf modal, which shipped with its copy flush
// against the card edge: the padded pane is the body helper's own wrapper,
// not something each caller has to remember. Asserting the *nesting* rather
// than the class's presence is the point — an empty wrapper rendered beside
// the content is exactly the shape that shipped.
#[test]
fn confirm_modal_body_nests_its_content_inside_the_padded_pane() {
    let html = render(rsx! { Harness {} });
    let pane = html
        .find(r#"class="del-body""#)
        .unwrap_or_else(|| panic!("padded pane missing from {html}"));
    let actions = html
        .find("del-actions")
        .unwrap_or_else(|| panic!("action row missing from {html}"));
    assert!(
        pane < actions,
        "the pane must open before the buttons: {html}"
    );
    let inside = &html[pane..actions];
    assert!(
        !inside.contains("</div>"),
        "the pane closes before its own action row: {html}"
    );
    assert!(
        inside.contains("del-title"),
        "title outside the pane: {html}"
    );
    assert!(inside.contains("del-copy"), "copy outside the pane: {html}");
}

#[component]
fn NoteHarness() -> Element {
    confirm_modal_body(
        "Delete shelf?",
        "This can't be undone.",
        Some(rsx! { p { class: "shelf-modal-error", "Couldn't delete this shelf." } }),
        vec![ConfirmModalAction {
            testid: "note-confirm".to_string(),
            label: "Delete".to_string(),
            tone: ConfirmModalTone::Danger,
            disabled: false,
            on_click: EventHandler::new(|_| {}),
        }],
    )
}

#[test]
fn confirm_modal_body_renders_a_note_ahead_of_the_action_row() {
    let html = render(rsx! { NoteHarness {} });
    let note = html
        .find("shelf-modal-error")
        .unwrap_or_else(|| panic!("note missing from {html}"));
    let actions = html
        .find("del-actions")
        .unwrap_or_else(|| panic!("action row missing from {html}"));
    assert!(
        note < actions,
        "a failure note belongs above the buttons that caused it, got: {html}"
    );
}

#[component]
fn BusyHarness() -> Element {
    confirm_modal_body(
        "Busy",
        "In progress",
        None,
        vec![ConfirmModalAction {
            testid: "sample-busy".to_string(),
            label: "Working\u{2026}".to_string(),
            tone: ConfirmModalTone::Danger,
            disabled: true,
            on_click: EventHandler::new(|_| {}),
        }],
    )
}

#[test]
fn confirm_modal_body_disables_every_action_when_told_to() {
    let html = render(rsx! { BusyHarness {} });
    assert!(html.contains("disabled"));
}

/// Runs [`dismiss_unless_busy`] inside a live scope (needed for
/// `EventHandler::new`) and records whether it fired.
#[component]
fn DismissHarness(busy: bool, fired: Rc<RefCell<bool>>) -> Element {
    let handler = EventHandler::new(move |_| *fired.borrow_mut() = true);
    dismiss_unless_busy(busy, handler);
    rsx! {}
}

#[test]
fn dismiss_unless_busy_calls_on_dismiss_when_not_busy() {
    let fired = Rc::new(RefCell::new(false));
    render(rsx! { DismissHarness { busy: false, fired: fired.clone() } });
    assert!(*fired.borrow());
}

#[test]
fn dismiss_unless_busy_is_a_noop_while_busy() {
    let fired = Rc::new(RefCell::new(false));
    render(rsx! { DismissHarness { busy: true, fired: fired.clone() } });
    assert!(!*fired.borrow());
}
