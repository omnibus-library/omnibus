//! Cover-grid view for the landing page.
//!
//! Renders the hydrated book list as Atrium `Cover` tiles, linking each to
//! the book-detail page. Used by [`super::LandingPage`] when the view-mode
//! toggle is set to grid. Under the marquee layout the tiles read as a cover
//! wall: the caption is a layer over the cover's foot that arrives on hover
//! (`.lmq .lib-tile-cap` in `atrium.css`) rather than a block beneath it.

use dioxus::prelude::*;
use dioxus_router::use_navigator;
use omnibus_shared::{EbookMetadata, SeriesStack};

use super::series_grid::{grid_items, is_stale, stack_leads, GridItem, VolumeCell};
use super::series_tiles::{StackCap, StackTile};
use super::sorting::{contributor_names, row_ident};
use crate::Route;

/// `sizes` for a wall cover — the column's rendered width per breakpoint.
pub(super) const TILE_SIZES: &str = "(max-width: 640px) 160px, (max-width: 1280px) 200px, 240px";

/// Deal-out / fold motion, run from a post-render effect so SSR markup stays identical (rule 07).
const SERIES_FLIP_JS: &str = include_str!("series_flip.js");

/// Entrance-cascade delay for tile `index`, mirroring the iOS settle cascade:
/// 40 ms steps, modulo 8 so late pages animate like the first.
pub(super) fn stagger_ms(index: usize) -> usize {
    (index % 8) * 40
}

#[component]
pub(super) fn BookGrid(
    books: Vec<EbookMetadata>,
    stacks: Vec<SeriesStack>,
    server_url: String,
) -> Element {
    // The dealt-out stack's lead uuid — one series open at a time.
    let open = use_signal(|| None::<String>);
    // The stack just folded, so its tile takes focus back from Fold up.
    let refocus = use_signal(|| None::<String>);
    // A run or refocus whose stack no longer leads is dropped, so a later page never revives it.
    let leads = stack_leads(&stacks);
    use_effect(use_reactive!(|leads| {
        let (mut open, mut refocus) = (open, refocus);
        if is_stale(open.peek().as_deref(), &leads) {
            open.set(None);
        }
        if is_stale(refocus.peek().as_deref(), &leads) {
            refocus.set(None);
        }
    }));
    // Replays after the grid patches for a deal-out or a fold.
    use_effect(move || {
        let _ = open();
        let _ = dioxus::document::eval(SERIES_FLIP_JS);
    });
    let cells: Vec<(String, usize, GridItem)> = grid_items(&books, &stacks, open().as_deref())
        .into_iter()
        .enumerate()
        .map(|(index, item)| (item.key(), index, item))
        .collect();

    rsx! {
        div {
            class: "lib-grid",
            "data-testid": "lib-grid",
            role: "list",
            onkeydown: move |evt: Event<KeyboardData>| {
                if evt.key() == Key::Escape && open.peek().is_some() {
                    evt.prevent_default();
                    fold(open, refocus);
                }
            },
            for (key, index, item) in cells {
                GridCell {
                    key: "{key}",
                    item,
                    index,
                    server_url: server_url.clone(),
                    open,
                    refocus,
                }
            }
        }
    }
}

/// One grid cell, keyed at the loop root so a deal-out moves the wall rather than rebuilding it.
#[component]
fn GridCell(
    item: GridItem,
    index: usize,
    server_url: String,
    open: Signal<Option<String>>,
    refocus: Signal<Option<String>>,
) -> Element {
    match item {
        GridItem::Book(book) => rsx! {
            GridTile { book, server_url, index }
        },
        GridItem::Stack(stack) => rsx! {
            StackTile {
                stack,
                server_url,
                index,
                refocus,
                on_open: move |picked: String| deal_out(open, refocus, picked),
            }
        },
        GridItem::Cap(stack) => rsx! {
            StackCap { stack, on_fold: move |_| fold(open, refocus) }
        },
        GridItem::Vol(cell) => rsx! {
            GridTile { book: cell.book.clone(), server_url, index, vol: Some(cell) }
        },
    }
}

/// Deal the stack led by `lead` out, folding any other.
fn deal_out(mut open: Signal<Option<String>>, mut refocus: Signal<Option<String>>, lead: String) {
    refocus.set(None);
    open.set(Some(lead));
}

/// Fold the open stack, remembering it so its tile takes focus back.
fn fold(mut open: Signal<Option<String>>, mut refocus: Signal<Option<String>>) {
    let folded = open.peek().clone();
    refocus.set(folded);
    open.set(None);
}

#[component]
fn GridTile(
    book: EbookMetadata,
    server_url: String,
    index: usize,
    // A dealt-out volume's run chrome; `None` for an ordinary tile.
    #[props(default)] vol: Option<VolumeCell>,
) -> Element {
    // Stable per-book uuid drives both detail-route URL and thumb URL
    // (see `Route::BookDetail`).
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let display_title = book.title.as_deref().unwrap_or(&book.filename).to_string();
    let tile_testid = format!("ebook-tile-{}", row_ident(&book));
    let authors = contributor_names(&book.creators);
    let nav = use_navigator();

    // Prefer the responsive `/api/thumbs/:uuid/{sm,md,lg}` endpoint over the
    // raw `/api/covers/:uuid`: smaller payload (WebP, resized per slot). Books
    // with no cover fall back to the Atrium plate template. Cache-busted per
    // `CoverCacheBust` so a cover edit is visible immediately on return to
    // the grid (issue #1087) rather than after the browser's 1-day thumb cache expires.
    let cover_bust =
        crate::contexts::cover_bust_for(crate::contexts::use_cover_cache_bust().0, &uuid);
    let (thumb_src, thumb_srcset) =
        crate::components::cover_tile::thumb_srcs(&book, &uuid, &server_url, cover_bust);

    let flip_key = row_ident(&book);
    let flip_from = vol.as_ref().map(|v| format!("stack-{}", v.lead_uuid));
    let flip_deck = vol.as_ref().map(|v| v.deck.to_string());

    let run_class = match vol.as_ref() {
        Some(v) if v.last => " ss-vol ss-vol--last",
        Some(_) => " ss-vol",
        None => "",
    };
    let band = vol
        .as_ref()
        .map(|v| v.band_style.clone())
        .unwrap_or_default();
    let caption = vol.map(|v| v.caption);

    let uuid_click = uuid.clone();
    let uuid_key = uuid.clone();

    rsx! {
        a {
            class: "cover-link lib-tile{run_class}",
            "data-testid": "{tile_testid}",
            "data-flip-key": "{flip_key}",
            "data-flip-from": flip_from,
            "data-flip-deck": flip_deck,
            role: "listitem",
            tabindex: "0",
            style: "animation-delay: {stagger_ms(index)}ms;{band}",
            aria_label: "Open details for {display_title}",
            onclick: move |_| { nav.push(Route::BookDetail { uuid: uuid_click.clone() }); },
            onkeydown: move |evt: Event<KeyboardData>| {
                let key = evt.key();
                if key == Key::Enter || key == Key::Character(" ".to_string()) {
                    evt.prevent_default();
                    nav.push(Route::BookDetail { uuid: uuid_key.clone() });
                }
            },
            // The art and the caption are separate layers: the wall lifts the
            // cover on hover and floats the words over its foot, so they can't
            // share one box.
            span { class: "lib-tile-art",
                crate::components::atrium::Cover {
                    book,
                    src_override: thumb_src,
                    srcset: thumb_srcset,
                    sizes: Some(TILE_SIZES.to_string()),
                }
            }
            span { class: "lib-tile-cap",
                span { class: "lib-tile-title", "{display_title}" }
                if !authors.is_empty() {
                    span { class: "lib-tile-author", "{authors}" }
                }
            }
            if let Some(caption) = caption {
                span { class: "ss-vn", "{caption}" }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::stagger_ms;

    #[test]
    fn stagger_ms_steps_by_40_and_wraps_every_eight_tiles() {
        assert_eq!(stagger_ms(0), 0);
        assert_eq!(stagger_ms(3), 120);
        assert_eq!(stagger_ms(7), 280);
        assert_eq!(stagger_ms(8), 0);
        assert_eq!(stagger_ms(19), 120);
    }
}
