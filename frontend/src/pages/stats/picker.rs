//! The household reader picker atop the stats hero: who the page is showing,
//! and — when anyone besides the caller shares — a dropdown to switch.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::HouseholdReader;

use crate::components::user_avatar::UserAvatar;
use crate::routes::link_target;
use crate::Route;

/// Name used when `?user=` names a reader the list doesn't carry.
const UNLISTED_READER: &str = "Another reader";

/// Whose figures the page shows, resolved against the household list.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Viewing {
    /// The signed-in reader: no `?user=`, or their own id.
    You,
    /// Another reader, by the list's name for them.
    Reader { name: String },
}

impl Viewing {
    /// The hero's heading: `None` on the caller's own page, so the hero's
    /// first-person copy is left untouched.
    pub(super) fn heading(&self) -> Option<String> {
        match self {
            Viewing::You => None,
            Viewing::Reader { name } => Some(format!("{name}'s stats")),
        }
    }
}

/// Resolve `user` against the household list. A listed id names its reader;
/// an unlisted one still needs somewhere to point (a stale link, a reader who
/// just turned sharing off), so it falls back to [`UNLISTED_READER`] rather
/// than rendering nothing.
pub(super) fn viewing(user: Option<i64>, readers: &[HouseholdReader]) -> Viewing {
    let Some(id) = user else {
        return Viewing::You;
    };
    match readers.iter().find(|r| r.id == id) {
        Some(r) if r.is_you => Viewing::You,
        Some(r) => Viewing::Reader {
            name: r.name.clone(),
        },
        None => Viewing::Reader {
            name: UNLISTED_READER.to_string(),
        },
    }
}

/// Whether the picker has anything to offer: at least one reader besides the
/// caller shares their stats.
pub(super) fn shows_picker(readers: &[HouseholdReader]) -> bool {
    readers.iter().any(|r| !r.is_you)
}

/// The reader dropdown: a trigger naming who is shown, and a menu of every
/// sharing household reader. Renders nothing when [`shows_picker`] is false.
#[component]
pub(super) fn ReaderPicker(readers: Vec<HouseholdReader>, selected: Option<i64>) -> Element {
    // Called unconditionally, before the early return below, so the hook
    // order can't change if `readers` arrives empty on the first render and
    // fills in on a later one (rule 07).
    let mut open = use_signal(|| false);
    if !shows_picker(&readers) {
        return rsx! {};
    }

    let current = viewing(selected, &readers);
    let viewed_name = match &current {
        Viewing::You => "You".to_string(),
        Viewing::Reader { name } => name.clone(),
    };
    let trigger_label = format!("Stats for {viewed_name}");
    // The avatar beside the trigger: the caller's own for `You`, the matched
    // reader's for a listed id — `None` (so no avatar) for an unlisted one.
    let selected_reader = match selected {
        Some(id) => readers.iter().find(|r| r.id == id),
        None => readers.iter().find(|r| r.is_you),
    };

    rsx! {
        div {
            class: "st-reader-bar",
            "data-testid": "stats-reader-picker",
            onkeydown: move |e: Event<KeyboardData>| {
                if e.key() == Key::Escape {
                    open.set(false);
                }
            },
            button {
                r#type: "button",
                class: "st-reader-trigger",
                "data-testid": "stats-reader-trigger",
                "aria-expanded": if open() { "true" } else { "false" },
                "aria-controls": "stats-reader-menu",
                // The kicker, avatar and name render as separate spans (the
                // avatar's own aria-hidden monogram sits between them), so
                // the accessible name is stated explicitly rather than left
                // to whatever the child text nodes concatenate to.
                "aria-label": "{trigger_label}",
                onclick: move |_| open.set(!open()),
                span { class: "st-reader-kicker", "Stats for" }
                if let Some(r) = selected_reader {
                    span { "aria-hidden": "true",
                        UserAvatar {
                            user_id: r.id,
                            name: r.name.clone(),
                            has_avatar: r.has_avatar,
                            class: "st-reader-avatar".to_string(),
                        }
                    }
                }
                span { class: "st-reader-name", {viewed_name} }
                span { "aria-hidden": "true", class: "st-reader-caret", "\u{25BE}" }
            }
            ul {
                id: "stats-reader-menu",
                class: "st-reader-menu",
                "data-testid": "stats-reader-menu",
                hidden: !open(),
                for r in readers.clone() {
                    li { key: "{r.id}",
                        Link {
                            class: "st-reader-option",
                            "data-testid": if r.is_you { "stats-reader-option-you".to_string() } else { format!("stats-reader-option-{}", r.id) },
                            to: link_target(Route::Stats { user: if r.is_you { None } else { Some(r.id) } }),
                            "aria-current": if selected == Some(r.id) || (selected.is_none() && r.is_you) { "page" } else { "false" },
                            onclick: move |_| open.set(false),
                            span { "aria-hidden": "true",
                                UserAvatar {
                                    user_id: r.id,
                                    name: r.name.clone(),
                                    has_avatar: r.has_avatar,
                                    class: "st-reader-avatar".to_string(),
                                }
                            }
                            span { class: "st-reader-option-name",
                                {if r.is_you { "You".to_string() } else { r.name.clone() }}
                            }
                        }
                    }
                }
            }
            if open() {
                div {
                    class: "st-reader-scrim",
                    "data-testid": "stats-reader-scrim",
                    onclick: move |_| open.set(false),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
