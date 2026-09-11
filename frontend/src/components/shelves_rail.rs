//! Left-rail shelf list — the shared library chrome for browse + shelf views.
//!
//! Lists the caller's visible shelves with a kind marker (cog for smart,
//! accent swatch for manual) and a visibility icon, plus an "All books" row
//! that returns to the landing grid. Mounts the create-shelf modal locally.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{ShelfKind, ShelfSummary, Visibility};

use crate::components::shelf_glyphs::{
    all_books_icon, cog_icon, heart_icon, lock_icon, people_icon,
};
use crate::components::CreateShelfModal;
use crate::{data, use_server_url, Route};

#[cfg(test)]
mod tests;

/// Which rail row is currently active — drives the highlight.
#[derive(Clone, Copy, PartialEq)]
pub enum RailActive {
    /// The "All books" row (landing page).
    All,
    /// A specific shelf's detail page.
    Shelf(i64),
}

/// The shelf rail. Fetches the caller's shelves on mount (SSR-safe: starts
/// empty so the first WASM paint matches the SSR markup) and renders one row
/// per shelf plus the "All books" entry.
///
/// `reload` is the host page's membership-edit counter: a row's count is a
/// server-side aggregate, so without re-reading it an add or remove made on
/// the page beside the rail left the rail asserting the old number until a
/// full reload (#2255).
#[component]
pub fn ShelvesRail(active: RailActive, #[props(default)] reload: u32) -> Element {
    let mut shelves = use_signal(Vec::<ShelfSummary>::new);
    let mut show_create = use_signal(|| false);
    let url = use_server_url();
    // `None` until the boot effect resolves the viewer (SSR + first paint).
    let viewer_id = crate::use_current_user_summary()().map(|u| u.id);

    let refetch_url = url.clone();
    let refetch = move || {
        let url = refetch_url.clone();
        spawn(async move {
            if let Ok(s) = data::list_shelves(&url).await {
                shelves.set(s);
            }
        });
    };

    // Mount fetch reuses `refetch` rather than re-implementing its body —
    // the two copies previously drifted independently (#1337). Re-runs on a
    // membership edit beside the rail and on a background cache
    // revalidation, the same channel every other shelf reader rides.
    let generation = crate::use_cache_generation();
    let refetch_on_change = refetch.clone();
    use_effect(use_reactive!(|reload| {
        let _ = reload;
        let _ = generation();
        refetch_on_change.clone()();
    }));

    let all_active = matches!(active, RailActive::All);
    let all_class = if all_active {
        "shelf-row shelf-row--active"
    } else {
        "shelf-row"
    };

    rsx! {
        aside { class: "shelf-rail", "data-testid": "shelves-rail",
            div { class: "shelf-rail-head",
                span { class: "label", "Shelves" }
                button {
                    r#type: "button",
                    class: "shelf-rail-new",
                    "data-testid": "new-shelf",
                    onclick: move |_| show_create.set(true),
                    "\u{FF0B} New shelf"
                }
            }

            nav { class: "shelf-rail-list", aria_label: "Shelves",
                Link {
                    to: Route::Landing {},
                    class: "{all_class}",
                    "data-testid": "rail-all-books",
                    span { class: "shelf-row-marker", {all_books_icon()} }
                    span { class: "shelf-row-name", "All books" }
                }

                for s in shelves.read().iter() {
                    {render_shelf_row(s, active, viewer_id)}
                }
            }

            p { class: "shelf-rail-foot mono", "Smart shelves update on their own" }
        }

        if show_create() {
            CreateShelfModal {
                on_close: move |_| show_create.set(false),
                on_created: move |_| {
                    show_create.set(false);
                    refetch();
                },
            }
        }
    }
}

/// One shelf row: kind marker, name (+ owner attribution when not yours),
/// count, visibility icon.
fn render_shelf_row(s: &ShelfSummary, active: RailActive, viewer_id: Option<i64>) -> Element {
    let id = s.id;
    let is_active = is_row_active(active, id);
    let class = if is_active {
        "shelf-row shelf-row--active"
    } else {
        "shelf-row"
    };
    let accent = s.accent.clone().unwrap_or_else(|| "var(--accent)".into());
    let not_mine = shows_owner_attribution(viewer_id, s.owner_user_id, s.kind);

    rsx! {
        Link {
            key: "{id}",
            to: Route::ShelfDetail { id },
            class: "{class}",
            "data-testid": "rail-shelf-{id}",
            span { class: "shelf-row-marker",
                match s.kind {
                    ShelfKind::Smart => rsx! { {cog_icon()} },
                    ShelfKind::Wishlist => rsx! { {heart_icon()} },
                    ShelfKind::Manual => rsx! {
                        span {
                            class: "shelf-row-swatch",
                            style: "background: {accent};",
                        }
                    },
                }
            }
            span { class: "shelf-row-name",
                "{s.name}"
                if not_mine {
                    span { class: "shelf-row-owner mono", "by {s.owner_username}" }
                }
            }
            span { class: "shelf-row-count mono", "{s.book_count}" }
            span { class: "shelf-row-vis",
                match s.visibility {
                    Visibility::Private => rsx! { {lock_icon()} },
                    Visibility::Public => rsx! { {people_icon()} },
                }
            }
        }
    }
}

/// `true` when `id` is the rail's currently active shelf row.
fn is_row_active(active: RailActive, id: i64) -> bool {
    matches!(active, RailActive::Shelf(other) if other == id)
}

/// `true` when a row should show "by <owner>" attribution: the shelf isn't
/// the viewer's own (only once the viewer is known — `None` withholds
/// attribution rather than guessing), and it isn't the Wishlist, whose name
/// already opens with the owner so the chip would repeat it.
pub(crate) fn shows_owner_attribution(
    viewer_id: Option<i64>,
    owner_user_id: i64,
    kind: ShelfKind,
) -> bool {
    viewer_id.is_some_and(|vid| vid != owner_user_id) && kind != ShelfKind::Wishlist
}
