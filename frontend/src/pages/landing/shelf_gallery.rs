//! The shelves row below the stack, drawn text first: names as type on a
//! hairline rule with up to three member covers peeking in above the name on
//! hover, which costs ~110px instead of the 170px the cover-mosaic tiles took.
//! Selecting filters the landing book list in place; only the heading's "All
//! shelves" link leaves, for the full `/shelves` index, which is now the only
//! way there since the top nav carries no Shelves link. Horizontal paging (the
//! caret buttons at the row's ends) is driven by `marquee.js`.
//!
//! The row carries a subset of what the index lists: [`rail_shelves`] applies
//! the same inclusion rule as the iOS landing rail, so another reader's
//! private shelves and every wishlist but the viewer's own stocked one stay
//! off it.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{ShelfKind, ShelfSummary, Visibility};

use crate::components::glyphs::{caret_left_glyph, caret_right_glyph, chevron_right_glyph};
use crate::components::loading::Skeleton;
use crate::components::shelf_glyphs::{cog_icon, heart_icon, plus_icon};
use crate::components::CreateShelfModal;
use crate::shelf_access::shows_owner_attribution;
use crate::shelf_selection::ShelfSelection;
use crate::Route;

use super::rail::rail_shelves;

/// How many member covers peek in above a shelf name on hover. Three reads as
/// a hint of the shelf without becoming a mosaic again.
pub(super) const PEEK_COVERS: usize = 3;

/// Spoken meta: `"N books"`, plus `Public` when the shelf is shared, plus
/// `by <owner>` when the viewer doesn't own it. The tab shows only
/// [`shelf_tab_meta`]; this keeps the rest within reach of a screen reader.
pub(super) fn shelf_meta_line(count: i64, visibility: Visibility, owner: Option<&str>) -> String {
    let mut line = if count == 1 {
        "1 book".to_string()
    } else {
        format!("{count} books")
    };
    if visibility == Visibility::Public {
        line.push_str(" \u{00b7} Public");
    }
    if let Some(owner) = owner {
        line.push_str(&format!(" \u{00b7} by {owner}"));
    }
    line
}

/// What follows a shelf's name in its tab: the book count, plus the owner
/// when the viewer doesn't own it. The spoken label carries the rest (unit,
/// kind, visibility), so the tab stays one line.
pub(super) fn shelf_tab_meta(count: i64, owner: Option<&str>) -> String {
    match owner {
        // Admins see every shelf, so without this an owner's private shelf is
        // indistinguishable from the viewer's own (#2248).
        Some(owner) => format!("{count} \u{00b7} {owner}"),
        None => count.to_string(),
    }
}

/// Spoken label for a shelf entry. The kind badge is a decorative glyph, so
/// "Smart" / "Wishlist" has to reach a screen reader through the label.
pub(super) fn shelf_aria_label(
    name: &str,
    count: i64,
    kind: ShelfKind,
    vis: Visibility,
    owner: Option<&str>,
) -> String {
    let kind_word = match kind {
        ShelfKind::Smart => "Smart shelf ",
        ShelfKind::Wishlist => "Wishlist ",
        ShelfKind::Manual => "",
    };
    format!("{kind_word}{name}, {}", shelf_meta_line(count, vis, owner))
}

/// The owner name a gallery entry should attribute to, or `None` when the
/// shelf is the viewer's own (or the viewer isn't resolved yet). Delegates
/// the rule to the rail so the two surfaces can't drift.
pub(super) fn attributed_owner(shelf: &ShelfSummary, viewer_id: Option<i64>) -> Option<&str> {
    shows_owner_attribution(viewer_id, shelf.owner_user_id, shelf.kind)
        .then_some(shelf.owner_username.as_str())
}

/// What a shelf's tab counts: the picked shelf's loaded member list, which
/// refetches with the pick, over the gallery summary, whose aggregate goes
/// stale when membership changes elsewhere (#2255).
pub(super) fn tab_count(
    shelf: &ShelfSummary,
    selection: ShelfSelection,
    picked_members: Option<usize>,
) -> i64 {
    match picked_members {
        Some(n) if selection == ShelfSelection::Shelf(shelf.id) => {
            i64::try_from(n).unwrap_or(shelf.book_count)
        }
        _ => shelf.book_count,
    }
}

/// Per-render snapshot of the row's data + selection state: the shelf list,
/// which one is picked, the "All Books" entry's count/covers, the server URL
/// for thumbnails, and the select/create callbacks.
#[derive(Clone, PartialEq, Props)]
pub(super) struct ShelfGalleryProps {
    pub shelves: Vec<ShelfSummary>,
    /// False until the shelves fetch has answered; placeholders hold the row.
    pub loaded: bool,
    pub selection: ShelfSelection,
    /// How many books the picked shelf holds, once its full member list loads.
    pub picked_members: Option<usize>,
    pub all_count: Option<i64>,
    pub all_cover_uuids: Vec<String>,
    pub server_url: String,
    pub on_select: EventHandler<ShelfSelection>,
    pub on_created: EventHandler<()>,
}

/// The row. Entries are toggle buttons (`aria-pressed` marks the pick); the
/// create-shelf modal mounts locally, same wiring as the shelf rail.
#[component]
pub(super) fn ShelfGallery(props: ShelfGalleryProps) -> Element {
    let ShelfGalleryProps {
        shelves,
        loaded,
        selection,
        picked_members,
        all_count,
        all_cover_uuids,
        server_url,
        on_select,
        on_created,
    } = props;
    let mut show_create = use_signal(|| false);
    // `None` until the boot effect resolves the viewer (SSR + first paint), so
    // attribution stays withheld rather than guessed — same rule as the rail.
    let viewer_id = crate::use_current_user_summary()().map(|u| u.id);
    // Same inclusion rule and same order as the iOS rail; the arrows page
    // through the result rather than capping it.
    let shelves = rail_shelves(&shelves, viewer_id);
    let all_active = selection == ShelfSelection::All;
    let all_meta = match all_count {
        Some(1) => "1 book".to_string(),
        Some(n) => format!("{n} books"),
        None => "Your whole library".to_string(),
    };
    rsx! {
        section {
            class: "lmq-shelves",
            "data-testid": "shelf-gallery",
            "aria-labelledby": "lmq-shelves-title",
            h2 { class: "lmq-shelves-title", id: "lmq-shelves-title", "Shelves" }
            // The section's own actions, on the heading's line and before the tabs in tab order.
            div { class: "lmq-slab-acts",
                button {
                    r#type: "button",
                    class: "lmq-slink",
                    "data-testid": "new-shelf",
                    onclick: move |_| show_create.set(true),
                    {plus_icon()}
                    "New shelf"
                }
                Link {
                    to: Route::Shelves {},
                    class: "lmq-slink",
                    "data-testid": "gallery-all-shelves",
                    "All shelves"
                    {chevron_right_glyph(12)}
                }
            }
            div { class: "lmq-shwrap",
                // Both arrows are always in the DOM and always inert until
                // `marquee.js` arms the end that has more to show — a
                // conditionally-rendered arrow would change the row's element
                // count between SSR and hydration (rule 07).
                button {
                    r#type: "button",
                    class: "lmq-shnav lmq-shnav--l",
                    "data-testid": "shelf-row-prev",
                    aria_label: "Earlier shelves",
                    tabindex: "-1",
                    {caret_left_glyph(16)}
                }
                button {
                    r#type: "button",
                    class: "lmq-shnav lmq-shnav--r",
                    "data-testid": "shelf-row-next",
                    aria_label: "More shelves",
                    tabindex: "-1",
                    {caret_right_glyph(16)}
                }
                div { class: "lmq-shtx", id: "lmq-shelf-row",
                    button {
                        r#type: "button",
                        class: "lmq-shent",
                        "data-testid": "gallery-all-books",
                        aria_pressed: all_active,
                        aria_label: "All Books, {all_meta}",
                        onclick: move |_| on_select.call(ShelfSelection::All),
                        {peek(&all_cover_uuids, &server_url, None)}
                        span { class: "lmq-shent-name", "All Books" }
                        if let Some(n) = all_count {
                            span { class: "lmq-shent-meta", "data-testid": "gallery-all-books-count", "{n}" }
                        }
                    }
                    for s in shelves.iter() {
                        ShelfRowEntry {
                            key: "{s.id}",
                            shelf: s.clone(),
                            count: tab_count(s, selection, picked_members),
                            active: selection == ShelfSelection::Shelf(s.id),
                            server_url: server_url.clone(),
                            viewer_id,
                            on_select,
                        }
                    }
                    if !loaded {
                        for i in 0..3usize {
                            span {
                                key: "pending-{i}",
                                class: "lmq-shent lmq-shent-pending",
                                "data-testid": "shelf-gallery-pending",
                                "aria-hidden": "true",
                                Skeleton { index: i, style: "--w:{118 - i * 18}px;height:20px" }
                            }
                        }
                    }
                }
            }
        }

        if show_create() {
            CreateShelfModal {
                on_close: move |_| show_create.set(false),
                on_created: move |_| {
                    show_create.set(false);
                    on_created.call(());
                },
            }
        }
    }
}

/// One shelf entry: hover peek, name, kind badge + meta line.
#[component]
fn ShelfRowEntry(
    shelf: ShelfSummary,
    count: i64,
    active: bool,
    server_url: String,
    viewer_id: Option<i64>,
    on_select: EventHandler<ShelfSelection>,
) -> Element {
    let id = shelf.id;
    let owner = attributed_owner(&shelf, viewer_id);
    let meta = shelf_tab_meta(count, owner);
    let label = shelf_aria_label(&shelf.name, count, shelf.kind, shelf.visibility, owner);
    let badge = match shelf.kind {
        ShelfKind::Smart => Some(cog_icon()),
        ShelfKind::Wishlist => Some(heart_icon()),
        ShelfKind::Manual => None,
    };
    rsx! {
        button {
            r#type: "button",
            class: "lmq-shent",
            "data-testid": "gallery-shelf-{id}",
            aria_pressed: active,
            aria_label: "{label}",
            onclick: move |_| on_select.call(ShelfSelection::Shelf(id)),
            {peek(&shelf.cover_uuids, &server_url, badge.clone())}
            span { class: "lmq-shent-name", "{shelf.name}" }
            span { class: "lmq-shent-meta",
                if let Some(glyph) = badge {
                    {glyph}
                }
                "{meta}"
            }
        }
    }
}

/// The covers that slide in above a name on hover — or, for a shelf with no
/// cover-bearing member, a single dashed plate carrying the kind glyph so the
/// row keeps its rhythm.
fn peek(cover_uuids: &[String], server_url: &str, glyph: Option<Element>) -> Element {
    if cover_uuids.is_empty() {
        return rsx! {
            span { class: "lmq-shent-peek", aria_hidden: true,
                span { class: "lmq-shent-none",
                    if let Some(glyph) = glyph {
                        {glyph}
                    }
                }
            }
        };
    }
    rsx! {
        span { class: "lmq-shent-peek", aria_hidden: true,
            for uuid in cover_uuids.iter().take(PEEK_COVERS) {
                span { key: "{uuid}",
                    img {
                        src: crate::thumb_url(server_url, uuid, "sm"),
                        alt: "",
                        loading: "lazy",
                        draggable: false,
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
