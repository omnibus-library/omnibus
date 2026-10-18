//! The toolbar's Stack series switch — the saved per-user preference that
//! folds each series into one grid tile. Account configuration (rule 08): a
//! click saves straight to the server, optimistically, and a refusal puts the
//! switch back with an inline alert; nothing is ever queued.

use dioxus::prelude::*;

/// Shown when a save fails; the switch has already gone back.
pub(super) const STACK_SAVE_ERROR: &str = "Couldn't save Stack series. Try again.";

/// What the switch shows this render.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct StackToggleView {
    /// The viewer's saved preference.
    pub(super) saved: bool,
    /// `/me` has resolved; until then `saved` is only the default.
    pub(super) ready: bool,
    /// The last save failed; the next click clears it.
    pub(super) failed: bool,
}

/// The switch: an `aria-pressed` button, followed by a failed save's alert.
#[component]
pub(super) fn StackToggle(view: StackToggleView, on_toggle: EventHandler<()>) -> Element {
    let disabled = !view.ready;
    let on = view.saved && !disabled;
    let class = if on {
        "ss-tog on"
    } else if !view.ready {
        "ss-tog pending"
    } else {
        "ss-tog"
    };
    rsx! {
        button {
            r#type: "button",
            class: "{class}",
            "data-testid": "lib-stack-toggle",
            "aria-pressed": "{on}",
            disabled: disabled,
            onclick: move |_| on_toggle.call(()),
            span { class: "ss-sw", aria_hidden: true }
            "Stack series"
        }
        if view.failed {
            span { class: "ss-terr", role: "alert", "data-testid": "lib-stack-error", "{STACK_SAVE_ERROR}" }
        }
    }
}

/// The switch's state and click handler, through the save every preference
/// switch shares.
pub(super) fn use_stack_toggle() -> (StackToggleView, EventHandler<()>) {
    use crate::pages::account::user_settings::{toggle, SaveState, UserSetting};

    let state = use_signal(|| SaveState::Idle);
    let viewer = crate::use_current_user().0;
    let saved = match &*viewer.read() {
        Some(Some(user)) => Some(user.stack_series),
        _ => None,
    };
    let view = StackToggleView {
        saved: saved.unwrap_or(false),
        ready: saved.is_some(),
        failed: state() == SaveState::Failed,
    };
    let on_toggle = EventHandler::new(move |_: ()| toggle(UserSetting::StackSeries, viewer, state));
    (view, on_toggle)
}
