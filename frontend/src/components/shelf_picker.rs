//! The "Add to shelf" picker: a modal listing the hand-picked shelves a reader
//! may change, reporting the row they choose. Stateless — the book-detail page
//! and the landing bulk bar own the shelves fetch and the write. Web-only.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{ShelfKind, ShelfSummary, UserSummary};

use crate::components::{BusyLabel, Loading, LoadingKind};
use crate::shelf_access::{shows_owner_attribution, ShelfAccess};
use crate::Route;

/// Hand-picked shelves `viewer` may change, in the order given — never Smart or
/// Wishlist, which fill themselves.
pub fn add_targets(shelves: &[ShelfSummary], viewer: &UserSummary) -> Vec<ShelfSummary> {
    shelves
        .iter()
        .filter(|s| {
            s.kind == ShelfKind::Manual
                && ShelfAccess::resolve(Some(viewer), s.owner_user_id, &s.owner_username, s.kind)
                    .can_edit()
        })
        .cloned()
        .collect()
}

/// The picker's `targets` for a shelves read and the viewer: loading until the
/// viewer is known, the failure as soon as the read has failed, otherwise
/// [`add_targets`].
pub fn picker_targets(
    read: Option<Result<&[ShelfSummary], ()>>,
    viewer: Option<&UserSummary>,
) -> Option<Result<Vec<ShelfSummary>, ()>> {
    match (read, viewer) {
        (Some(Ok(all)), Some(viewer)) => Some(Ok(add_targets(all, viewer))),
        (Some(Err(())), _) => Some(Err(())),
        _ => None,
    }
}

/// What a [`ShelfPickerModal`] draws. The default is the loading state.
#[derive(Clone, Default, PartialEq)]
pub struct ShelfPickerList {
    /// `None` until the shelves and the viewer are both known; `Err` when the
    /// shelves read failed.
    pub targets: Option<Result<Vec<ShelfSummary>, ()>>,
    /// The viewer, so a shelf they don't own can name its owner.
    pub viewer_id: Option<i64>,
    /// `Some(ids)`: rows are checkboxes showing these memberships. `None`: rows
    /// are one-shot picks.
    pub checked: Option<Vec<i64>>,
    /// The row whose write is in flight; every row is inert while `Some`.
    pub busy: Option<i64>,
    /// The last write's failure; the rows keep their state.
    pub error: Option<String>,
}

/// Modal over `list`; `on_pick` gets the chosen shelf's id. Dismissing is held
/// back while a write is in flight so its failure is never closed unseen.
#[component]
pub fn ShelfPickerModal(
    heading: String,
    list: ShelfPickerList,
    on_pick: EventHandler<i64>,
    on_close: EventHandler<()>,
) -> Element {
    let idle = list.busy.is_none();
    let dismiss = move || {
        if idle {
            on_close.call(());
        }
    };
    rsx! {
        div {
            class: "shelf-modal-overlay",
            "data-testid": "shelf-picker",
            onclick: move |_| dismiss(),
            div {
                class: "shelf-modal-card shelf-picker-card",
                role: "dialog",
                "aria-modal": "true",
                "aria-labelledby": "shelf-picker-title",
                tabindex: "-1",
                onclick: move |e| e.stop_propagation(),
                onkeydown: move |e| {
                    if e.key() == Key::Escape {
                        dismiss();
                    }
                },
                // Focusable so Escape reaches the handler above; focus would
                // otherwise sit on the trigger behind the overlay.
                onmounted: move |evt: MountedEvent| crate::focus_after_paint::focus_after_paint(&evt),

                div { class: "pick-head",
                    div {
                        span { class: "pick-kicker", "Hand-picked shelves" }
                        h2 {
                            class: "pick-title",
                            id: "shelf-picker-title",
                            "data-testid": "shelf-picker-title",
                            "{heading}"
                        }
                    }
                    button {
                        r#type: "button",
                        class: "pick-close",
                        "aria-label": "Close",
                        "data-testid": "shelf-picker-close",
                        disabled: !idle,
                        onclick: move |_| dismiss(),
                        "\u{2715}"
                    }
                }

                {picker_body(&list, on_pick, on_close)}

                if let Some(msg) = list.error.as_deref() {
                    p {
                        role: "alert",
                        class: "shelf-modal-error",
                        "data-testid": "shelf-picker-error",
                        "{msg}"
                    }
                }
            }
        }
    }
}

/// The modal's middle: a loader, the failure, the empty state, or the rows.
fn picker_body(
    list: &ShelfPickerList,
    on_pick: EventHandler<i64>,
    on_close: EventHandler<()>,
) -> Element {
    match &list.targets {
        None => rsx! {
            Loading {
                kind: LoadingKind::Sheet,
                testid: "shelf-picker-loading",
                label: "Gathering your shelves",
            }
        },
        Some(Err(())) => rsx! {
            p { class: "pick-state", "data-testid": "shelf-picker-unavailable",
                "Your shelves didn\u{2019}t load. Close this and try again."
            }
        },
        Some(Ok(targets)) if targets.is_empty() => rsx! {
            div { class: "pick-state", "data-testid": "shelf-picker-empty",
                p { "You have no hand-picked shelves yet." }
                p {
                    "Make one on the "
                    Link {
                        to: Route::Landing {},
                        class: "bdmq-k-link",
                        onclick: move |_| on_close.call(()),
                        "library page \u{2192}"
                    }
                }
            }
        },
        Some(Ok(targets)) => rsx! {
            div { class: "shelf-picker-list",
                for shelf in targets.iter() {
                    {picker_row(shelf, list, on_pick)}
                }
            }
        },
    }
}

/// One shelf row: a checkbox when the picker shows memberships, otherwise a
/// plain button.
fn picker_row(shelf: &ShelfSummary, list: &ShelfPickerList, on_pick: EventHandler<i64>) -> Element {
    let id = shelf.id;
    let is_busy = list.busy == Some(id);
    let is_on = list.checked.as_ref().map(|ids| ids.contains(&id));
    let role = is_on.map(|_| "checkbox");
    let aria_checked = is_on.map(|on| if on { "true" } else { "false" });
    let attributed = shows_owner_attribution(list.viewer_id, shelf.owner_user_id, shelf.kind);
    rsx! {
        button {
            key: "{id}",
            r#type: "button",
            class: "shelf-picker-row",
            role,
            "aria-checked": aria_checked,
            "aria-busy": if is_busy { "true" } else { "false" },
            "data-testid": "shelf-picker-row-{id}",
            disabled: list.busy.is_some(),
            onclick: move |_| on_pick.call(id),
            if let Some(on) = is_on {
                span { class: "shelf-picker-check", "aria-hidden": "true",
                    if on {
                        "\u{2713}"
                    }
                }
            }
            span { class: "shelf-picker-text",
                span { class: "shelf-picker-name",
                    BusyLabel { busy: is_busy, label: shelf.name.clone(), busy_label: shelf.name.clone() }
                }
                if attributed {
                    span { class: "shelf-picker-owner", "by {shelf.owner_username}" }
                }
            }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
