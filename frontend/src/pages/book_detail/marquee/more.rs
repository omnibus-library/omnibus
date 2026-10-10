//! Stop 06 · More — everything that points away from this book, in one
//! place: the shelves it sits on (its series' shelf, then the reader's own
//! shelves), the rest of the author's work, then what to read next.
//! Fetches post-mount (rule 07: SSR and the first WASM paint render the
//! same quiet shell).

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::physical::WishlistEntry;
use omnibus_shared::{
    EbookMetadata, SeriesDetail, ShelfKind, ShelfSummary, SuggestionsResponse, UserSummary,
};

use crate::components::atrium::Cover;
use crate::components::shelf_picker::{add_targets, ShelfPickerList, ShelfPickerModal};
use crate::components::{Loading, LoadingKind};
use crate::contexts::use_current_user_summary;
use crate::{data, use_server_url, Route};

use super::super::body::{BdAuthorCluster, BdPageCtx, BdSameHand, BdSuggestionsStrip};
use super::MarqueeViewFacts;

/// Everything the More stop needs beyond the book, bundled to keep the
/// component under the prop-count guideline (mirrors `MarqueeStageCtx`).
#[derive(Clone, PartialEq, Props)]
pub(super) struct MoreStopCtx {
    pub series: Option<SeriesDetail>,
    /// False until the stage fetch has returned — `series: None` after that
    /// means the series couldn't be read, not that it is still coming.
    pub series_loaded: bool,
    pub author_books: Option<Vec<EbookMetadata>>,
    pub suggestions: Option<SuggestionsResponse>,
    pub page: BdPageCtx,
    /// The viewer's wishlist entry for this book, shared with the hero so the
    /// shelf list follows the Add / Remove buttons without a refetch.
    pub wishlist: Signal<Option<WishlistEntry>>,
}

/// The More stop: the series shelf (when there is one) and the shelves holding
/// this book, the author's other work, then suggestions. The series is fetched once by the stage and threaded in, so
/// this stop and the Home kicker read the same record.
///
/// These were two stops until the running order collapsed to six — the shelf
/// is not a subject of its own, it is one of the three ways this page points
/// away from the book it is about.
#[component]
pub(super) fn MarqueeMoreStop(
    b: EbookMetadata,
    view: MarqueeViewFacts,
    ctx: MoreStopCtx,
) -> Element {
    let MoreStopCtx {
        series,
        series_loaded,
        author_books,
        suggestions,
        page,
        wishlist,
    } = ctx;
    rsx! {
        div { class: "bdmq-tight bdmq-more", "data-testid": "bdmq-more",
            if let Some(series_id) = b.series_id {
                MarqueeSeriesShelf {
                    series_id,
                    series_name: view.series.clone().unwrap_or_default(),
                    current_uuid: b.unique_identifier.clone().unwrap_or_default(),
                    detail: series,
                    loaded: series_loaded,
                }
            }
            MarqueeShelfMembership {
                uuid: b.unique_identifier.clone().unwrap_or_default(),
                wishlist,
                in_series: b.series_id.is_some(),
            }
            div { class: "bdmq-morerule" }
            BdSameHand {
                author: BdAuthorCluster {
                    primary_author: view.primary_author.clone(),
                    author_id: view.author_id,
                    author_books,
                    current_uuid: b.unique_identifier.clone().unwrap_or_default(),
                },
            }
            // The suggestions strip opens with its own `.divider`, which the
            // panel hides (`.bdmq-tight .divider`) — so inside More it would
            // butt straight up against the author's shelf. Give it the same
            // rule the block above it gets.
            div { class: "bdmq-morerule" }
            BdSuggestionsStrip {
                book_title: view.title.clone(),
                suggestions,
                ctx: page,
            }
        }
    }
}

/// The whole series as covers, in reading order.
#[component]
fn MarqueeSeriesShelf(
    series_id: i64,
    series_name: String,
    current_uuid: String,
    detail: Option<SeriesDetail>,
    loaded: bool,
) -> Element {
    let count = detail.as_ref().map(|d| d.book_count).unwrap_or(0);
    // "Up next": the next series entry after this one. Per-book progress
    // isn't on the listing wire, so the pill marks position, not state.
    let next_uuid: Option<String> = detail.as_ref().and_then(|d| {
        let idx = d
            .books
            .iter()
            .position(|x| x.unique_identifier.as_deref() == Some(current_uuid.as_str()))?;
        d.books
            .get(idx + 1)
            .and_then(|x| x.unique_identifier.clone())
    });

    rsx! {
        div { class: "bdmq-k",
            "{series_name}"
            if count > 0 {
                // The design reads "you own N of M", but M (the series' full
                // published length) isn't something the library knows — only
                // what it holds. Name that instead of inventing a total.
                " \u{b7} {count} in your library"
            }
        }
        if let Some(d) = detail {
            div { class: "rx-shelf", "data-testid": "bdmq-series-shelf",
                for x in d.books.iter() {
                    {render_series_item(x, &current_uuid, next_uuid.as_deref())}
                }
            }
            div { class: "mono bdmq-quiet-hint",
                Link { to: Route::SeriesDetail { id: series_id }, class: "bdmq-k-link", "series page \u{2192}" }
            }
        } else if !loaded {
            Loading {
                kind: LoadingKind::Section,
                class: "start",
                testid: "bdmq-series-loading",
                label: "Gathering the series",
            }
        } else {
            div { class: "mono bdmq-quiet-hint", "data-testid": "bdmq-series-unavailable",
                "the shelf didn\u{2019}t load \u{2014} "
                Link { to: Route::SeriesDetail { id: series_id }, class: "bdmq-k-link", "series page \u{2192}" }
            }
        }
    }
}

/// One series-shelf cover with its caption and (maybe) the Up-next pill.
fn render_series_item(x: &EbookMetadata, current_uuid: &str, next_uuid: Option<&str>) -> Element {
    let x_uuid = x.unique_identifier.clone().unwrap_or_default();
    let current = x_uuid == current_uuid;
    let title = x.display_title();
    let sub = match (x.series_index.as_deref(), current) {
        (Some(n), true) => format!("Book {n} \u{b7} this book"),
        (Some(n), false) => format!("Book {n}"),
        (None, true) => "this book".to_string(),
        (None, false) => String::new(),
    };
    rsx! {
        Link {
            key: "{x_uuid}",
            to: Route::BookDetail { uuid: x_uuid.clone() },
            class: if current { "cover-link rx-shelf-item current" } else { "cover-link rx-shelf-item" },
            if next_uuid == Some(x_uuid.as_str()) {
                span { class: "rx-upnext", "Up next" }
            }
            Cover { book: x.clone() }
            div { class: "rx-shelf-cap",
                div { class: "t", "{title}" }
                if !sub.is_empty() {
                    div { class: "u", "{sub}" }
                }
            }
        }
    }
}

/// The shelves read behind the membership block: every visible shelf and the
/// ids of those holding this book. `None` while asking; `Err` when either read
/// failed, so the stop never claims "not on a shelf" off a fetch that didn't
/// answer.
type ShelvesRead = Option<Result<(Vec<ShelfSummary>, Vec<i64>), ()>>;

/// The Add-to-shelf picker's open flag and its write's in-flight / failed state.
#[derive(Clone, Copy)]
struct PickerState {
    open: Signal<bool>,
    busy: Signal<Option<i64>>,
    error: Signal<Option<String>>,
}

/// The shelves holding this book, as chips — the hand-picked ones plus the
/// viewer's own Wishlist when the book is on it — and the picker that adds the
/// book to a hand-picked shelf or takes it off again. `in_series` sits the block
/// under the series shelf, which already says what the book is part of.
///
/// The wishlist shelf's membership derives from `wishlist_entries`, not
/// `shelf_books`, so the per-book membership read never names it; the landing
/// gallery counts the book under it all the same. It is read off the page's
/// own wishlist signal instead, so it appears the moment the Add button lands
/// and goes with Remove.
#[component]
fn MarqueeShelfMembership(
    uuid: String,
    wishlist: Signal<Option<WishlistEntry>>,
    in_series: bool,
) -> Element {
    let server_url = use_server_url();
    let me = use_current_user_summary();
    let mut shelves = use_signal(ShelvesRead::default);
    // A fast SPA hop between books can leave the previous book's shelf fetch
    // in flight; drop its result rather than showing it under the new book.
    let mut load_seq = use_signal(|| 0u64);
    let picker = PickerState {
        open: use_signal(|| false),
        busy: use_signal(|| None::<i64>),
        error: use_signal(|| None::<String>),
    };
    {
        let server_url = server_url.clone();
        let (mut open, mut busy, mut error) = (picker.open, picker.busy, picker.error);
        use_effect(use_reactive!(|uuid| {
            let my_load = *load_seq.peek() + 1;
            load_seq.set(my_load);
            shelves.set(None);
            open.set(false);
            busy.set(None);
            error.set(None);
            let url = server_url.clone();
            let uuid = uuid.clone();
            spawn(async move {
                let all = data::list_shelves(&url).await;
                let holding = data::shelves_containing(&url, &uuid).await;
                if *load_seq.peek() == my_load {
                    shelves.set(Some(match (all, holding) {
                        (Ok(all), Ok(ids)) => Ok((all, ids)),
                        _ => Err(()),
                    }));
                }
            });
        }));
    }
    let held = shelves().map(|answer| {
        answer.map(|(all, ids)| {
            let my_id = me().map(|u| u.id);
            let wished = wishlist().is_some();
            all.into_iter()
                .filter(|s| {
                    ids.contains(&s.id)
                        || (wished
                            && s.kind == ShelfKind::Wishlist
                            && Some(s.owner_user_id) == my_id)
                })
                .collect::<Vec<ShelfSummary>>()
        })
    });
    let toggle = build_shelf_toggle(server_url, uuid, shelves, load_seq, picker);
    let list = shelf_picker_list(&shelves(), me().as_ref(), picker);
    let mut open = picker.open;

    rsx! {
        {membership_body(held.as_ref(), in_series, EventHandler::new(move |_| open.set(true)))}
        if open() {
            ShelfPickerModal {
                heading: "Add to shelf".to_string(),
                list,
                on_pick: toggle,
                on_close: move |_| open.set(false),
            }
        }
    }
}

/// What the picker shows: the shelves the viewer may change, ticked for the
/// ones holding this book. Loading until both the shelves and the viewer are
/// known.
fn shelf_picker_list(
    read: &ShelvesRead,
    viewer: Option<&UserSummary>,
    picker: PickerState,
) -> ShelfPickerList {
    let checked = match read {
        Some(Ok((_, ids))) => Some(ids.clone()),
        _ => None,
    };
    let targets = match (read, viewer) {
        (Some(Ok((all, _))), Some(viewer)) => Some(Ok(add_targets(all, viewer))),
        (Some(Err(())), _) => Some(Err(())),
        _ => None,
    };
    ShelfPickerList {
        targets,
        viewer_id: viewer.map(|u| u.id),
        checked,
        busy: (picker.busy)(),
        error: (picker.error)(),
    }
}

/// Builds the picker's row handler: add this book to the shelf, or take it off
/// when it is already there, then patch the block's membership so the row and
/// the chips follow without a refetch. A failure leaves both as they were.
fn build_shelf_toggle(
    server_url: String,
    uuid: String,
    shelves: Signal<ShelvesRead>,
    load_seq: Signal<u64>,
    picker: PickerState,
) -> EventHandler<i64> {
    EventHandler::new(move |shelf_id: i64| {
        let (mut shelves, mut busy, mut error) = (shelves, picker.busy, picker.error);
        if busy.peek().is_some() {
            return;
        }
        let Some(Ok((all, ids))) = shelves.peek().clone() else {
            return;
        };
        let adding = !ids.contains(&shelf_id);
        let name = all
            .iter()
            .find(|s| s.id == shelf_id)
            .map(|s| s.name.clone())
            .unwrap_or_default();
        let my_load = *load_seq.peek();
        let (url, uuid) = (server_url.clone(), uuid.clone());
        busy.set(Some(shelf_id));
        error.set(None);
        spawn(async move {
            let written = if adding {
                data::add_shelf_books(&url, shelf_id, vec![uuid.clone()]).await
            } else {
                data::remove_shelf_book(&url, shelf_id, &uuid).await
            };
            // A hop to another book resets the block; its write must not land there.
            if *load_seq.peek() != my_load {
                return;
            }
            match written {
                Ok(()) => shelves.with_mut(|read| {
                    if let Some(Ok((_, ids))) = read {
                        *ids = with_membership(ids, shelf_id, adding);
                    }
                }),
                Err(e) => error.set(Some(format!("Couldn\u{2019}t update {name}: {e}"))),
            }
            busy.set(None);
        });
    })
}

/// The button that opens the shelf picker.
fn add_to_shelf_button(on_add: EventHandler<()>) -> Element {
    rsx! {
        div { class: "bdmq-shelf-actions",
            button {
                r#type: "button",
                class: "btn sm",
                "data-testid": "bdmq-add-to-shelf",
                onclick: move |_| on_add.call(()),
                "Add to shelf"
            }
        }
    }
}

/// `ids` with `shelf_id` added (`on`) or removed, never duplicated.
fn with_membership(ids: &[i64], shelf_id: i64, on: bool) -> Vec<i64> {
    let mut next = ids.to_vec();
    if on {
        if !next.contains(&shelf_id) {
            next.push(shelf_id);
        }
    } else {
        next.retain(|id| *id != shelf_id);
    }
    next
}

/// The membership block for the given shelves read: its kicker, then chips and
/// the empty state, each with the Add-to-shelf button, or a failure note, or a
/// loader. A series book on no shelf gets only the button — the series shelf
/// above it already fills the stop.
fn membership_body(
    held: Option<&Result<Vec<ShelfSummary>, ()>>,
    in_series: bool,
    on_add: EventHandler<()>,
) -> Element {
    let (kicker_class, kicker) = if in_series {
        ("bdmq-k bdmq-k-below", "On your shelves")
    } else {
        ("bdmq-k", "Standalone \u{b7} on your shelves")
    };
    rsx! {
        div { class: kicker_class, "{kicker}" }
        match held {
            Some(Ok(held)) if !held.is_empty() => rsx! {
                div { class: "bdmq-chips bdmq-shelfchips", "data-testid": "bdmq-shelves",
                    for (i, s) in held.iter().enumerate() {
                        span {
                            key: "{s.id}",
                            class: if i == 0 { "chip bdmq-shelfchip first" } else { "chip bdmq-shelfchip" },
                            style: if let Some(a) = s.accent.clone() { format!("--accent:{a};") } else { String::new() },
                            "{s.name}"
                        }
                    }
                }
                {add_to_shelf_button(on_add)}
            },
            Some(Ok(_)) => rsx! {
                if !in_series {
                    div { class: "bdmq-bigquiet", "Not on a shelf yet." }
                }
                {add_to_shelf_button(on_add)}
            },
            Some(Err(())) => rsx! {
                p { class: "mono bdmq-quiet-hint", "data-testid": "bdmq-shelves-unavailable",
                    "your shelves didn\u{2019}t load \u{2014} see them on the "
                    Link { to: Route::Landing {}, class: "bdmq-k-link", "library page \u{2192}" }
                }
            },
            None => rsx! {
                Loading {
                    kind: LoadingKind::Section,
                    class: "start",
                    testid: "bdmq-shelves-loading",
                    label: "Checking your shelves",
                }
            },
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
