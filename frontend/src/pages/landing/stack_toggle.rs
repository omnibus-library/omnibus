//! The toolbar's Stack series switch — the saved per-user preference that
//! folds each series into one grid tile. Account configuration (rule 08): a
//! click saves straight to the server, optimistically, and a refusal puts the
//! switch back with an inline alert; nothing is ever queued.

use dioxus::prelude::*;
use omnibus_shared::{UserSummary, ViewMode};

use crate::data;

/// Shown when a save fails; the switch has already gone back.
pub(super) const STACK_SAVE_ERROR: &str = "Couldn't save Stack series. Try again.";

/// What the switch shows this render.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct StackToggleView {
    /// The viewer's saved preference.
    pub(super) saved: bool,
    /// `/me` has resolved; until then `saved` is only the default.
    pub(super) ready: bool,
    /// Why the switch is inert here (the saved value stays put); `None` leaves it live.
    pub(super) note: Option<&'static str>,
    /// The last save's failure, cleared by the next click.
    pub(super) error: Option<String>,
}

/// Why Stack series can't apply: a search shows every match, the table one row per book.
pub(super) fn stack_toggle_note(view_mode: ViewMode, is_search: bool) -> Option<&'static str> {
    if is_search {
        Some("Unstacked while searching")
    } else if view_mode == ViewMode::Table {
        Some("Grid only")
    } else {
        None
    }
}

/// The switch: an `aria-pressed` button between the inert view's note and a failed save's alert.
#[component]
pub(super) fn StackToggle(view: StackToggleView, on_toggle: EventHandler<()>) -> Element {
    let disabled = !view.ready || view.note.is_some();
    let on = view.saved && !disabled;
    let class = if on {
        "ss-tog on"
    } else if !view.ready {
        "ss-tog pending"
    } else {
        "ss-tog"
    };
    rsx! {
        if let Some(note) = view.note {
            span { class: "ss-tnote", "data-testid": "lib-stack-note", "{note}" }
        }
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
        if let Some(message) = view.error.as_ref() {
            span { class: "ss-terr", role: "alert", "data-testid": "lib-stack-error", "{message}" }
        }
    }
}

/// The switch's state and click handler: flip the cached viewer, save, and revert on failure.
pub(super) fn use_stack_toggle(note: Option<&'static str>) -> (StackToggleView, EventHandler<()>) {
    let error = use_signal(|| None::<String>);
    let saving = use_signal(|| false);
    let viewer_slot = crate::use_current_user().0;
    let saved = match &*viewer_slot.read() {
        Some(Some(user)) => Some(user.stack_series),
        _ => None,
    };
    let view = StackToggleView {
        saved: saved.unwrap_or(false),
        ready: saved.is_some(),
        note,
        error: error(),
    };
    let on_toggle = EventHandler::new(move |_: ()| {
        let was = match &*viewer_slot.peek() {
            Some(Some(user)) => user.stack_series,
            _ => return,
        };
        if *saving.peek() {
            return;
        }
        let (mut error, mut saving) = (error, saving);
        saving.set(true);
        error.set(None);
        set_viewer_stack_series(viewer_slot, !was);
        spawn(async move {
            if data::set_stack_series("", !was).await.is_err() {
                set_viewer_stack_series(viewer_slot, was);
                error.set(Some(STACK_SAVE_ERROR.to_string()));
            }
            saving.set(false);
        });
    });
    (view, on_toggle)
}

/// Write `value` into the cached viewer's `stack_series`, if one is cached.
fn set_viewer_stack_series(mut slot: Signal<Option<Option<UserSummary>>>, value: bool) {
    slot.with_mut(|s| {
        if let Some(Some(user)) = s.as_mut() {
            user.stack_series = value;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_toggle_note_says_why_the_switch_is_inert_and_prefers_search() {
        assert_eq!(stack_toggle_note(ViewMode::Grid, false), None);
        assert_eq!(stack_toggle_note(ViewMode::Table, false), Some("Grid only"));
        assert_eq!(
            stack_toggle_note(ViewMode::Table, true),
            Some("Unstacked while searching")
        );
    }
}
