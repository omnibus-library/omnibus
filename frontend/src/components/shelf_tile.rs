//! The shelf tile: member covers standing on a ledge lit in the shelf's accent,
//! then its name, kind and visibility, and its book count beside the owner.
//! Shared by the shelves index cards, the book page's shelves and the "Add to
//! shelf" picker, which each wrap [`ShelfTileFace`] in the element they need.

use dioxus::prelude::*;
use omnibus_shared::{ShelfKind, ShelfSummary};

use crate::components::shelf_facets::visibility_label;
use crate::components::shelf_glyphs::{kind_icon, visibility_icon};
use crate::components::user_avatar::UserAvatar;
use crate::shelf_access::shows_owner_attribution;

/// How many books stand on a tile's ledge.
pub const LEDGE_BOOKS: usize = 4;

/// The classes of the element wrapping a [`ShelfTileFace`]; `compact` is the
/// smaller size the book page and the picker draw.
pub fn tile_class(compact: bool) -> &'static str {
    if compact {
        "shv-card shv-card--compact"
    } else {
        "shv-card"
    }
}

/// The wrapper's inline style: the shelf's accent, or the app's own.
pub fn accent_style(shelf: &ShelfSummary) -> String {
    let accent = shelf.accent.as_deref().unwrap_or("var(--accent)");
    format!("--shelf-accent: {accent};")
}

/// Whose shelf this is, as the viewer reads it: "You", "by {name}", or the bare
/// name for a Wishlist (whose own name already opens with its owner) and before
/// the viewer is known.
pub fn viewer_owner_label(viewer_id: Option<i64>, shelf: &ShelfSummary) -> String {
    if viewer_id == Some(shelf.owner_user_id) {
        "You".to_string()
    } else if shows_owner_attribution(viewer_id, shelf.owner_user_id, shelf.kind) {
        format!("by {}", shelf.owner_username)
    } else {
        shelf.owner_username.clone()
    }
}

/// The tile's inner markup — ledge, then name, facets and foot. The caller
/// supplies the element around it (a link, a button, a plain block) carrying
/// [`tile_class`] and [`accent_style`]. `owner_label` is what the foot says;
/// `owner_testid` tags it, for the one surface that selects on it; `name_id`
/// ids the name, for a wrapper that is named by the shelf alone.
#[component]
pub fn ShelfTileFace(
    shelf: ShelfSummary,
    owner_label: String,
    server_url: String,
    avatar_bust: u32,
    #[props(into, default)] owner_testid: Option<String>,
    #[props(into, default)] name_id: Option<String>,
) -> Element {
    rsx! {
        {ledge(&shelf, &server_url)}
        div { class: "shv-card-body",
            div { class: "shv-card-name", id: name_id, "{shelf.name}" }
            div { class: "shv-card-facets",
                span { class: "shv-facet shv-facet--kind",
                    {kind_icon(shelf.kind)}
                    "{kind_label(shelf.kind)}"
                }
                span { class: "shv-facet",
                    {visibility_icon(shelf.visibility)}
                    "{visibility_label(shelf.visibility)}"
                }
            }
            div { class: "shv-card-foot",
                span { class: "shv-card-count", "{book_count_label(shelf.book_count)}" }
                span { class: "shv-card-owner", "data-testid": owner_testid,
                    // The name sits beside it, so the photo's alt would only
                    // repeat it inside the tile's accessible name.
                    span { class: "shv-card-owner-av", aria_hidden: "true",
                        UserAvatar {
                            user_id: shelf.owner_user_id,
                            name: shelf.owner_username.clone(),
                            has_avatar: shelf.owner_has_avatar,
                            class: "shv-av",
                            bust: avatar_bust,
                        }
                    }
                    span { class: "shv-card-owner-name", "{owner_label}" }
                }
            }
        }
    }
}

/// The covers standing on the ledge; blank plates for members with no cover;
/// an empty plate carrying the kind glyph when the shelf holds nothing.
fn ledge(shelf: &ShelfSummary, server_url: &str) -> Element {
    let blanks = if shelf.cover_uuids.is_empty() {
        usize::try_from(shelf.book_count)
            .unwrap_or(0)
            .min(LEDGE_BOOKS)
    } else {
        0
    };
    rsx! {
        div { class: "shv-ledge", aria_hidden: "true",
            for uuid in shelf.cover_uuids.iter().take(LEDGE_BOOKS) {
                span { key: "{uuid}", class: "shv-ledge-book",
                    img {
                        src: crate::thumb_url(server_url, uuid, "sm"),
                        alt: "",
                        loading: "lazy",
                        draggable: false,
                    }
                }
            }
            for i in 0..blanks {
                span { key: "blank-{i}", class: "shv-ledge-book shv-ledge-book--blank" }
            }
            if shelf.book_count == 0 {
                span { class: "shv-ledge-empty",
                    {kind_icon(shelf.kind)}
                    "{empty_ledge_label(shelf.kind)}"
                }
            }
        }
    }
}

/// Kind word on a tile.
pub fn kind_label(kind: ShelfKind) -> &'static str {
    match kind {
        ShelfKind::Smart => "Smart",
        ShelfKind::Manual => "Hand-picked",
        ShelfKind::Wishlist => "Wishlist",
    }
}

/// `"1 book"` / `"N books"`.
pub fn book_count_label(count: i64) -> String {
    if count == 1 {
        "1 book".into()
    } else {
        format!("{count} books")
    }
}

/// What an empty ledge says, in the kind's own terms.
pub fn empty_ledge_label(kind: ShelfKind) -> &'static str {
    match kind {
        ShelfKind::Smart => "No matches yet",
        ShelfKind::Manual => "Empty shelf",
        ShelfKind::Wishlist => "Nothing wished for",
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
