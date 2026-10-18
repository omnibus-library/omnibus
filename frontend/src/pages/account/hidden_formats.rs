//! The hidden-formats setting (Settings › Preferences) picks which formats the
//! reader's landing All Books view excludes, as one group of checkboxes over
//! the shared known-format vocabulary (plus any saved token the list doesn't
//! know, so it can always be un-hidden). A change saves at once. The cached
//! viewer takes it optimistically, which moves the landing's fetch key without
//! a reload, and saves run one at a time, each carrying the whole set, so a
//! quick run of clicks can't land out of order.

use std::collections::BTreeSet;

use dioxus::prelude::*;
use omnibus_shared::{UserSummary, KNOWN_LIBRARY_FORMATS};

use crate::components::{Loading, LoadingKind};
use crate::data;

use super::user_settings::{save_status, SaveState};

/// `hidden` with `fmt` hidden (`on`) or shown, sorted and without repeats.
fn with_format(hidden: Vec<String>, fmt: &str, on: bool) -> Vec<String> {
    let mut set: BTreeSet<String> = hidden.into_iter().collect();
    if on {
        set.insert(fmt.to_string());
    } else {
        set.remove(fmt);
    }
    set.into_iter().collect()
}

/// The checkboxes to draw: every known format, then any saved one the list
/// doesn't know.
fn format_options(hidden: &[String]) -> Vec<String> {
    let known = KNOWN_LIBRARY_FORMATS.iter().map(|f| f.to_string());
    let unknown = hidden
        .iter()
        .filter(|f| !KNOWN_LIBRARY_FORMATS.contains(&f.as_str()))
        .cloned();
    known.chain(unknown).collect()
}

/// The cached viewer's hidden formats, once `/me` has resolved.
fn hidden_of(viewer: &Option<Option<UserSummary>>) -> Option<Vec<String>> {
    viewer.as_ref()?.as_ref().map(|u| u.hidden_formats.clone())
}

/// The hidden-formats group. Waits on the viewer rather than draw every box
/// unchecked, which would claim nothing is hidden.
#[component]
pub(crate) fn HiddenFormatsField() -> Element {
    let viewer = crate::use_current_user().0;
    let state = use_signal(|| SaveState::Idle);
    let hidden = hidden_of(&viewer.read());

    rsx! {
        fieldset {
            class: "pref-fieldset",
            "data-testid": "account-hidden-formats-card",
            "aria-describedby": "hidden-formats-desc",
            legend { class: "setting-row-label", "Hidden formats" }
            p { class: "setting-row-desc", id: "hidden-formats-desc",
                "Hide these from your All Books view. A book stays visible while it has a "
                "format you haven\u{2019}t hidden; other readers are unaffected."
            }
            match hidden {
                Some(hidden) => rsx! {
                    div { class: "hidden-formats-list",
                        for fmt in format_options(&hidden) {
                            FormatToggle {
                                key: "{fmt}",
                                checked: hidden.contains(&fmt),
                                fmt,
                                viewer,
                                state,
                            }
                        }
                    }
                    {save_status("hidden-formats-status", state())}
                },
                None => rsx! {
                    Loading {
                        kind: LoadingKind::Section,
                        class: "start",
                        testid: "hidden-formats-loading",
                        label: "Reading your preference\u{2026}",
                    }
                },
            }
        }
    }
}

/// One format's checkbox, labelled in capitals.
#[component]
fn FormatToggle(
    fmt: String,
    checked: bool,
    viewer: Signal<Option<Option<UserSummary>>>,
    state: Signal<SaveState>,
) -> Element {
    let label = fmt.to_uppercase();
    let toggle_fmt = fmt.clone();
    rsx! {
        label { class: "hidden-format-row", r#for: "hidden-format-{fmt}",
            input {
                r#type: "checkbox",
                id: "hidden-format-{fmt}",
                "data-testid": "hidden-format-toggle-{fmt}",
                checked,
                onchange: move |e| change_format(&toggle_fmt, e.checked(), viewer, state),
            }
            span { class: "mono", "{label}" }
        }
    }
}

/// Whether a save loop is out, app-wide, because the field may have remounted
/// since it started and a second loop would take the unconfirmed set as its
/// baseline.
static LOOP_OUT: GlobalSignal<bool> = Signal::global(|| false);

/// Apply one checkbox change to the cached viewer and make sure a save is
/// running; the running save picks up every change made before it finishes.
fn change_format(
    fmt: &str,
    on: bool,
    mut viewer: Signal<Option<Option<UserSummary>>>,
    mut state: Signal<SaveState>,
) {
    let Some(current) = hidden_of(&viewer.peek()) else {
        return;
    };
    write_hidden(&mut viewer, with_format(current.clone(), fmt, on));
    if *LOOP_OUT.peek() {
        return;
    }
    *LOOP_OUT.write() = true;
    state.set(SaveState::Saving);
    spawn_save_loop(viewer, current, state);
}

/// Save the viewer's set until the server holds it, putting back `confirmed`
/// (what it last accepted) if a save fails. Runs at the root because unchecking
/// a format the list doesn't know unmounts its checkbox and leaving the page
/// unmounts the field, but the save still has to settle the viewer.
fn spawn_save_loop(
    mut viewer: Signal<Option<Option<UserSummary>>>,
    mut confirmed: Vec<String>,
    mut state: Signal<SaveState>,
) {
    dioxus::core::spawn_forever(async move {
        let settled = loop {
            let want = hidden_of(&viewer.peek()).unwrap_or_default();
            if want == confirmed {
                break SaveState::Saved;
            }
            if data::set_hidden_formats("", want.clone()).await.is_err() {
                write_hidden(&mut viewer, confirmed);
                break SaveState::Failed;
            }
            confirmed = want;
        };
        *LOOP_OUT.write() = false;
        if let Ok(mut state) = state.try_write() {
            *state = settled;
        }
    });
}

/// Write `hidden` into the cached viewer, if one is cached.
fn write_hidden(viewer: &mut Signal<Option<Option<UserSummary>>>, hidden: Vec<String>) {
    viewer.with_mut(|slot| {
        if let Some(Some(user)) = slot.as_mut() {
            user.hidden_formats = hidden;
        }
    });
}

#[cfg(test)]
mod tests;
