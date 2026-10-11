//! One card on the web shelves index: the shared shelf tile wrapped in a link
//! to the shelf — covers standing on a ledge lit in its accent, then its name,
//! kind and visibility, and its book count beside the owner's avatar.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::ShelfSummary;

use crate::components::shelf_tile::{accent_style, tile_class, ShelfTileFace};
use crate::Route;

/// One shelf card. `is_viewer` names the owner "You".
#[component]
pub fn ShelfCard(
    shelf: ShelfSummary,
    is_viewer: bool,
    server_url: String,
    avatar_bust: u32,
) -> Element {
    let id = shelf.id;
    let style = accent_style(&shelf);
    let owner_label = if is_viewer {
        "You".to_string()
    } else {
        shelf.owner_username.clone()
    };
    rsx! {
        div { class: "shv-cell", role: "listitem",
            Link {
                to: Route::ShelfDetail { id },
                class: tile_class(false),
                style,
                "data-testid": "shelf-card-{id}",
                ShelfTileFace {
                    shelf,
                    owner_label,
                    server_url,
                    avatar_bust,
                    owner_testid: format!("shelf-card-owner-{id}"),
                }
            }
        }
    }
}
