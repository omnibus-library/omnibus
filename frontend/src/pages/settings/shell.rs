//! The two-pane frame `/settings` and `/admin` share: a sidebar of text-only
//! section links beside the open section. Under 720px it reads as a list, then
//! a page. CSS keys that on `has-section` (set when a `?section=` is present),
//! so SSR and the first client paint emit the same markup whatever the viewport.

use dioxus::prelude::*;
use dioxus_router::Link;

use crate::components::confirm_modal::{
    confirm_modal_body, ConfirmModal, ConfirmModalAction, ConfirmModalTone,
};
use crate::components::unsaved::{provide_unsaved_changes, DirtyForms, UnsavedChanges};
use crate::Route;

/// A section switch held back because a form in the open section has edits.
#[derive(Clone, Copy)]
struct PendingLeave(Signal<Option<Route>>);

/// Sidebar plus content. `back_to` is the section-less route a narrow
/// screen's "‹ {title}" link returns to (none on a refusal); `back_keeps`
/// says that route renders the open section, so following it drops no edits.
#[component]
pub(crate) fn SettingsShell(
    title: &'static str,
    testid: &'static str,
    nav_label: &'static str,
    back_to: Option<Route>,
    back_keeps: bool,
    has_section: bool,
    nav: Element,
    children: Element,
) -> Element {
    provide_unsaved_changes();
    let pending = use_context_provider(|| PendingLeave(Signal::new(None)));
    let class = if has_section {
        "settings-layout has-section"
    } else {
        "settings-layout"
    };
    rsx! {
        if pending.0().is_some() {
            DiscardEditsModal {}
        }
        div { class, "data-testid": testid,
            nav { class: "settings-sidebar", "aria-label": nav_label,
                div { class: "settings-sidebar-head",
                    h1 { "{title}" }
                }
                {nav}
            }
            div { class: "settings-content",
                if let Some(to) = back_to {
                    BackLink { to, title, here: back_keeps }
                }
                {children}
            }
        }
    }
}

/// A labelled run of sidebar links; `label` is omitted for an ungrouped list,
/// and `divided` rules it off from the groups above.
#[component]
pub(crate) fn NavGroup(
    label: Option<&'static str>,
    #[props(default)] divided: bool,
    children: Element,
) -> Element {
    rsx! {
        div { class: if divided { "settings-nav-group divided" } else { "settings-nav-group" },
            if let Some(label) = label {
                div { class: "settings-nav-group-label", "{label}" }
            }
            {children}
        }
    }
}

/// One sidebar link, marked `aria-current="page"` when it is the open section.
#[component]
pub(crate) fn NavItem(to: Route, label: &'static str, testid: String, active: bool) -> Element {
    let (dirty, ask) = leave_guard(to.clone(), active);
    rsx! {
        Link {
            to: crate::routes::link_target(to),
            class: if active { "settings-nav-item active" } else { "settings-nav-item" },
            "data-testid": testid,
            "aria-current": if active { "page" } else { "false" },
            onclick_only: dirty,
            onclick: ask,
            "{label}"
        }
    }
}

/// "‹ {title}", the narrow screen's way from a section back to the list.
#[component]
fn BackLink(to: Route, title: &'static str, here: bool) -> Element {
    let (dirty, ask) = leave_guard(to.clone(), here);
    rsx! {
        Link {
            to: crate::routes::link_target(to),
            class: "settings-back",
            "data-testid": "settings-back",
            onclick_only: dirty,
            onclick: ask,
            span { "aria-hidden": "true", "‹ " }
            "{title}"
        }
    }
}

/// Whether a link to `to` must ask before leaving (a form holds edits and the
/// link isn't to the section already open), and the click that asks.
fn leave_guard(to: Route, here: bool) -> (bool, impl FnMut(MouseEvent) + 'static) {
    let unsaved = try_use_context::<UnsavedChanges>();
    let pending = try_use_context::<PendingLeave>();
    let dirty = !here && unsaved.is_some_and(|changes| changes.is_dirty());
    let ask = move |_| {
        if let Some(PendingLeave(mut pending)) = pending.filter(|_| dirty) {
            pending.set(Some(to.clone()));
        }
    };
    (dirty, ask)
}

/// "Discard unsaved changes?" for a held-back section switch.
#[component]
fn DiscardEditsModal() -> Element {
    let PendingLeave(mut pending) = use_context::<PendingLeave>();
    let UnsavedChanges(mut forms) = use_context::<UnsavedChanges>();
    let nav = dioxus_router::use_navigator();
    let discard = move |_| {
        if let Some(route) = pending.take() {
            forms.set(DirtyForms::default());
            nav.push(crate::routes::link_target(route));
        }
    };
    rsx! {
        ConfirmModal {
            testid: "unsaved-confirm",
            aria_label: "Discard unsaved changes",
            dialog_class: "mg-modal del-modal",
            busy: false,
            focus_on_open: true,
            on_dismiss: move |_| pending.set(None),
            {confirm_modal_body(
                "Discard unsaved changes?",
                "You've edited a setting in this section without saving it.",
                None,
                vec![
                    ConfirmModalAction {
                        testid: "unsaved-keep".into(),
                        label: "Keep editing".into(),
                        busy_label: None,
                        busy: false,
                        tone: ConfirmModalTone::Ghost,
                        disabled: false,
                        on_click: EventHandler::new(move |_| pending.set(None)),
                    },
                    ConfirmModalAction {
                        testid: "unsaved-discard".into(),
                        label: "Discard".into(),
                        busy_label: None,
                        busy: false,
                        tone: ConfirmModalTone::Danger,
                        disabled: false,
                        on_click: EventHandler::new(discard),
                    },
                ],
            )}
        }
    }
}

/// The open section's heading; each card below says what it holds.
#[component]
pub(crate) fn SectionHeader(title: &'static str) -> Element {
    rsx! {
        header { class: "settings-section-head",
            h2 { "{title}" }
        }
    }
}
