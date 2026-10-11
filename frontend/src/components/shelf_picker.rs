//! The "Add to shelf" picker: a modal laying out the hand-picked shelves a
//! reader may change as shelf tiles, reporting the one they choose, with the
//! smart shelves a book already matches below as read-only tiles. Stateless —
//! the book-detail page and the landing bulk bar own the shelves fetch and the
//! write. Web-only.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{ShelfKind, ShelfSummary, UserSummary};

use crate::components::shelf_tile::{accent_style, tile_class, viewer_owner_label, ShelfTileFace};
use crate::components::{Loading, LoadingKind, MarkSize, Ring};
use crate::shelf_access::ShelfAccess;
use crate::{use_server_url, AvatarCacheBust, Route};

/// What the picker tells the reader about the shelves it leaves out.
const HAND_PICKED_ONLY_HINT: &str =
    "Only shelves you fill by hand are listed; smart shelves add books by their rules.";

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
    /// `Some(ids)`: tiles are checkboxes showing these memberships. `None`:
    /// tiles are one-shot picks.
    pub checked: Option<Vec<i64>>,
    /// The tile whose write is in flight; every tile is inert while `Some`.
    pub busy: Option<i64>,
    /// The last write's failure; the tiles keep their state.
    pub error: Option<String>,
    /// The smart shelves the book already matches, drawn read-only below the
    /// hand-picked ones. Empty when the picker spans many books.
    pub automatic: Vec<ShelfSummary>,
}

/// What every tile needs to draw its covers and its owner's avatar.
struct TileEnv {
    server_url: String,
    avatar_bust: u32,
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
    let env = TileEnv {
        server_url: use_server_url(),
        avatar_bust: try_use_context::<AvatarCacheBust>().map_or(0, |b| (b.0)()),
    };
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

                p { class: "shelf-picker-hint", "data-testid": "shelf-picker-hint", "{HAND_PICKED_ONLY_HINT}" }

                {picker_body(&list, &env, on_pick, on_close)}

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

/// The modal's middle: a loader, the failure, or the scrolling tiles — the
/// hand-picked grid (or its empty state) with the automatic section below it.
fn picker_body(
    list: &ShelfPickerList,
    env: &TileEnv,
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
        Some(Ok(targets)) => rsx! {
            div { class: "shelf-picker-list",
                if targets.is_empty() {
                    {no_targets(on_close)}
                } else {
                    div { class: "shelf-picker-grid",
                        for shelf in targets.iter() {
                            {picker_tile(shelf, list, env, on_pick)}
                        }
                    }
                }
                {automatic_section(list, env)}
            }
        },
    }
}

/// The empty state: the reader has no hand-picked shelf to file into.
fn no_targets(on_close: EventHandler<()>) -> Element {
    rsx! {
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
    }
}

/// One shelf tile: a checkbox when the picker shows memberships, otherwise a
/// plain button. Its corner badge fills when the book is on the shelf and turns
/// to a ring while the write is in flight.
fn picker_tile(
    shelf: &ShelfSummary,
    list: &ShelfPickerList,
    env: &TileEnv,
    on_pick: EventHandler<i64>,
) -> Element {
    let id = shelf.id;
    let is_busy = list.busy == Some(id);
    let is_on = list.checked.as_ref().map(|ids| ids.contains(&id));
    let role = is_on.map(|_| "checkbox");
    let aria_checked = is_on.map(|on| if on { "true" } else { "false" });
    rsx! {
        button {
            key: "{id}",
            r#type: "button",
            class: "{tile_class(true)} shelf-picker-tile",
            style: accent_style(shelf),
            role,
            "aria-checked": aria_checked,
            "aria-busy": if is_busy { "true" } else { "false" },
            // The face also carries count and owner; the shelf's name alone names the tile.
            "aria-labelledby": "shelf-picker-name-{id}",
            "data-testid": "shelf-picker-tile-{id}",
            disabled: list.busy.is_some(),
            onclick: move |_| on_pick.call(id),
            if is_on.is_some() || is_busy {
                span { class: "shelf-picker-check", "aria-hidden": "true",
                    if is_busy {
                        Ring { size: MarkSize::Xs }
                    } else if is_on == Some(true) {
                        "\u{2713}"
                    }
                }
            }
            ShelfTileFace {
                shelf: shelf.clone(),
                owner_label: viewer_owner_label(list.viewer_id, shelf),
                server_url: env.server_url.clone(),
                avatar_bust: env.avatar_bust,
                name_id: "shelf-picker-name-{id}",
            }
        }
    }
}

/// The smart shelves the book already matches, as tiles that cannot be
/// toggled: their membership follows their rules. Nothing when there are none.
fn automatic_section(list: &ShelfPickerList, env: &TileEnv) -> Element {
    if list.automatic.is_empty() {
        return rsx! {};
    }
    rsx! {
        section { class: "shelf-picker-automatic", "data-testid": "shelf-picker-automatic",
            h3 { class: "shelf-picker-auto-title", "Automatic \u{b7} follows each shelf's rules" }
            div { class: "shelf-picker-grid",
                for shelf in list.automatic.iter() {
                    div {
                        key: "{shelf.id}",
                        class: "{tile_class(true)} shelf-picker-auto-tile",
                        style: accent_style(shelf),
                        "data-testid": "shelf-picker-auto-{shelf.id}",
                        ShelfTileFace {
                            shelf: shelf.clone(),
                            owner_label: viewer_owner_label(list.viewer_id, shelf),
                            server_url: env.server_url.clone(),
                            avatar_bust: env.avatar_bust,
                        }
                    }
                }
            }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
