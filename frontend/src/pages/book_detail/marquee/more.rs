//! Stop 06 · More — everything that points away from this book, in one
//! place: the shelves it sits on (its series' shelf, then every shelf holding
//! it as a tile), the rest of the author's work, then what to read next.
//! Fetches post-mount (rule 07: SSR and the first WASM paint render the
//! same quiet shell).

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::physical::WishlistEntry;
use omnibus_shared::{
    EbookMetadata, SeriesDetail, ShelfKind, ShelfSummary, SuggestionsResponse, UserSummary,
};

use crate::components::atrium::Cover;
use crate::components::shelf_glyphs::plus_icon;
use crate::components::shelf_picker::{picker_targets, ShelfPickerList, ShelfPickerModal};
use crate::components::shelf_tile::{
    accent_style, tile_class, viewer_owner_label, ShelfTileFace, LEDGE_BOOKS,
};
use crate::components::{Loading, LoadingKind};
use crate::contexts::use_current_user_summary;
use crate::{data, use_server_url, AvatarCacheBust, Route};

use super::super::body::{BdAuthorCluster, BdPageCtx, BdSameHand, BdSuggestionsStrip};
use super::super::rule_facts::use_rule_facts_saved;
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
    /// True once `wishlist` holds the server's answer rather than its seed.
    pub wishlist_loaded: Signal<bool>,
}

/// The More stop: the series shelf (when there is one) and the shelves holding
/// this book, the author's other work, then suggestions. The series is fetched
/// once by the stage and threaded in, so this stop and the Home kicker read the
/// same record.
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
        wishlist_loaded,
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
                has_cover: b.cover_url.is_some(),
                wishlist,
                wishlist_loaded,
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

/// What the membership block knows once its reads have answered: every visible
/// shelf, and the ids of those holding this book by hand and by rule.
#[derive(Clone, Debug, PartialEq)]
struct ShelvesFacts {
    all: Vec<ShelfSummary>,
    manual_ids: Vec<i64>,
    smart_ids: Vec<i64>,
    /// Whether this book was on the viewer's Wishlist when `all` was read, so a
    /// wish made since can be counted into that shelf's tile. `None` when the
    /// wishlist hadn't answered yet and so it can't be told.
    wished_at_read: Option<bool>,
}

impl ShelvesFacts {
    /// The shelves among `all` whose id is in `ids`, in `all`'s order.
    fn named<'a>(&'a self, ids: &'a [i64]) -> impl Iterator<Item = &'a ShelfSummary> {
        self.all.iter().filter(|s| ids.contains(&s.id))
    }

    /// These facts with the shelf list, the smart matches and the wishlist
    /// baseline re-read. The hand-picked ids stay: no save on this page moves them.
    fn refreshed(
        &self,
        all: Vec<ShelfSummary>,
        smart_ids: Vec<i64>,
        wished_at_read: Option<bool>,
    ) -> Self {
        Self {
            all,
            manual_ids: self.manual_ids.clone(),
            smart_ids,
            wished_at_read,
        }
    }
}

/// The shelves read behind the membership block. `None` while asking; `Err`
/// when any read failed, so the stop never claims "not on a shelf" off a fetch
/// that didn't answer.
type ShelvesRead = Option<Result<ShelvesFacts, ()>>;

/// The block's three reads as one answer: all of them, or the failure.
fn shelves_facts<E>(
    all: Result<Vec<ShelfSummary>, E>,
    manual: Result<Vec<i64>, E>,
    smart: Result<Vec<i64>, E>,
    wished_at_read: Option<bool>,
) -> Result<ShelvesFacts, ()> {
    match (all, manual, smart) {
        (Ok(all), Ok(manual_ids), Ok(smart_ids)) => Ok(ShelvesFacts {
            all,
            manual_ids,
            smart_ids,
            wished_at_read,
        }),
        _ => Err(()),
    }
}

/// How the membership effect reads when it fires.
#[derive(Clone, Copy, Debug, PartialEq)]
enum ShelvesLoad {
    /// A book not read yet, or no usable answer to keep: start over from the loader.
    Fresh,
    /// The same book with its answer in hand: a save on the page may have moved
    /// a rule's verdict, so re-read the lists in place.
    Refresh,
}

/// Which read the effect makes, given the book `loaded` last started for.
fn shelves_load(loaded: Option<&str>, uuid: &str, read: &ShelvesRead) -> ShelvesLoad {
    match read {
        Some(Ok(_)) if loaded == Some(uuid) => ShelvesLoad::Refresh,
        _ => ShelvesLoad::Fresh,
    }
}

/// Every shelf holding the book, in the order the block draws them: the
/// hand-picked ones, the smart ones whose rules match it, then the viewer's own
/// Wishlist when the book is on it.
///
/// The wishlist shelf's membership derives from `wishlist_entries`, not
/// `shelf_books`, so neither membership read names it; the landing gallery
/// counts the book under it all the same. It is read off the page's own
/// wishlist signal instead, so it appears the moment the Add button lands and
/// goes with Remove — counted in when the read predates the wish.
fn held_shelves(
    facts: &ShelvesFacts,
    viewer_id: Option<i64>,
    wished: bool,
    uuid: &str,
    has_cover: bool,
) -> Vec<ShelfSummary> {
    let wishlist = facts
        .all
        .iter()
        .filter(|s| wished && s.kind == ShelfKind::Wishlist && Some(s.owner_user_id) == viewer_id)
        .map(|s| match facts.wished_at_read {
            Some(false) => with_wished_book(s, uuid, has_cover),
            _ => s.clone(),
        });
    facts
        .named(&facts.manual_ids)
        .chain(facts.named(&facts.smart_ids))
        .cloned()
        .chain(wishlist)
        .collect()
}

/// The Add-to-shelf picker's open flag and its write's in-flight / failed state.
#[derive(Clone, Copy)]
struct PickerState {
    open: Signal<bool>,
    busy: Signal<Option<i64>>,
    error: Signal<Option<String>>,
}

impl PickerState {
    /// Close the picker and forget its write.
    fn reset(self) {
        let Self {
            mut open,
            mut busy,
            mut error,
        } = self;
        open.set(false);
        busy.set(None);
        error.set(None);
    }
}

/// What the membership block draws its tiles with.
struct BlockCtx {
    /// A series book on no shelf gets only the button: the series shelf above
    /// it already says what the book is part of.
    in_series: bool,
    viewer_id: Option<i64>,
    server_url: String,
    avatar_bust: u32,
}

/// The block's reads: what they found, which book they started for, and the
/// counters that let an answer to a superseded read be dropped.
#[derive(Clone, Copy)]
struct ReadState {
    shelves: Signal<ShelvesRead>,
    /// The book the last fresh read was for.
    book: Signal<Option<String>>,
    /// Bumped by each fresh read, and by a hop to another book.
    load_seq: Signal<u64>,
    /// Bumped by each in-place refresh.
    refresh_seq: Signal<u64>,
    wishlist: Signal<Option<WishlistEntry>>,
    wishlist_loaded: Signal<bool>,
}

impl ReadState {
    /// Whether the book is on the Wishlist right now, or `None` while that
    /// answer hasn't come in. What a read that lands now is measured against.
    fn wished_at_read(self) -> Option<bool> {
        (*self.wishlist_loaded.peek()).then(|| self.wishlist.peek().is_some())
    }
}

/// Every shelf holding this book, as tiles — the hand-picked ones, the smart
/// ones whose rules match it, and the viewer's own Wishlist when the book is on
/// it — and the picker that adds the book to a hand-picked shelf or takes it
/// off again. `in_series` sits the block under the series shelf, which already
/// says what the book is part of; `has_cover` is whether the book can stand on
/// a shelf's ledge. The block re-reads when a save on the page may have moved a
/// smart shelf's verdict.
#[component]
fn MarqueeShelfMembership(
    uuid: String,
    has_cover: bool,
    wishlist: Signal<Option<WishlistEntry>>,
    wishlist_loaded: Signal<bool>,
    in_series: bool,
) -> Element {
    let server_url = use_server_url();
    let avatar_bust = try_use_context::<AvatarCacheBust>().map_or(0, |b| (b.0)());
    let me = use_current_user_summary();
    let saved = use_rule_facts_saved();
    // A fast SPA hop between books can leave the previous book's shelf fetch
    // in flight; `load_seq` drops its result rather than showing it under the
    // new book.
    let read = ReadState {
        shelves: use_signal(ShelvesRead::default),
        book: use_signal(|| None::<String>),
        load_seq: use_signal(|| 0u64),
        refresh_seq: use_signal(|| 0u64),
        wishlist,
        wishlist_loaded,
    };
    let picker = PickerState {
        open: use_signal(|| false),
        busy: use_signal(|| None::<i64>),
        error: use_signal(|| None::<String>),
    };
    {
        let server_url = server_url.clone();
        use_effect(use_reactive!(|uuid| {
            // Subscribes: each save on the page re-runs this effect.
            let _ = saved.count();
            // Bound first: a `peek` guard held across the arms would still be
            // borrowing `shelves` when a read writes it.
            let load = shelves_load(read.book.peek().as_deref(), &uuid, &read.shelves.peek());
            match load {
                ShelvesLoad::Fresh => read_fresh(read, picker, server_url.clone(), uuid.clone()),
                ShelvesLoad::Refresh => read_refresh(read, server_url.clone(), uuid.clone()),
            }
        }));
    }
    let shelves = read.shelves;
    let viewer_id = me().map(|u| u.id);
    let held = shelves().map(|answer| {
        answer.map(|facts| held_shelves(&facts, viewer_id, wishlist().is_some(), &uuid, has_cover))
    });
    let toggle = build_shelf_toggle(
        server_url.clone(),
        uuid,
        has_cover,
        shelves,
        read.load_seq,
        picker,
    );
    let list = shelf_picker_list(&shelves(), me().as_ref(), picker);
    let ctx = BlockCtx {
        in_series,
        viewer_id,
        server_url,
        avatar_bust,
    };
    let (mut open, mut error) = (picker.open, picker.error);
    let on_add = EventHandler::new(move |_| {
        error.set(None);
        open.set(true);
    });

    rsx! {
        {membership_body(held.as_ref(), &ctx, on_add)}
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

/// Start over for `uuid`: the loader, a closed picker, then all three reads.
fn read_fresh(read: ReadState, picker: PickerState, url: String, uuid: String) {
    let ReadState {
        mut shelves,
        mut book,
        mut load_seq,
        ..
    } = read;
    let my_load = *load_seq.peek() + 1;
    load_seq.set(my_load);
    book.set(Some(uuid.clone()));
    shelves.set(None);
    picker.reset();
    spawn(async move {
        let all = data::list_shelves(&url).await;
        let manual = data::shelves_containing(&url, &uuid).await;
        let smart = data::smart_shelves_containing(&url, &uuid).await;
        if *load_seq.peek() == my_load {
            let wished = read.wished_at_read();
            shelves.set(Some(shelves_facts(all, manual, smart, wished)));
        }
    });
}

/// Re-read the shelf list and the smart matches behind the tiles already
/// drawn, so a shelf the book just started to match appears with its true count.
fn read_refresh(read: ReadState, url: String, uuid: String) {
    let ReadState {
        mut shelves,
        load_seq,
        mut refresh_seq,
        ..
    } = read;
    let my_load = *load_seq.peek();
    let my_refresh = *refresh_seq.peek() + 1;
    refresh_seq.set(my_refresh);
    spawn(async move {
        let all = data::list_shelves(&url).await;
        let smart = data::smart_shelves_containing(&url, &uuid).await;
        if *load_seq.peek() != my_load || *refresh_seq.peek() != my_refresh {
            return;
        }
        // A background read that failed leaves the tiles as they were.
        let (Ok(all), Ok(smart_ids)) = (all, smart) else {
            return;
        };
        let wished = read.wished_at_read();
        shelves.with_mut(|current| {
            if let Some(Ok(facts)) = current {
                *facts = facts.refreshed(all, smart_ids, wished);
            }
        });
    });
}

/// What the picker shows: the shelves the viewer may change, ticked for the
/// ones holding this book, and the smart shelves that hold it by rule. Loading
/// until both the shelves and the viewer are known.
fn shelf_picker_list(
    read: &ShelvesRead,
    viewer: Option<&UserSummary>,
    picker: PickerState,
) -> ShelfPickerList {
    let facts = read.as_ref().and_then(|answer| answer.as_ref().ok());
    let shelves = read.as_ref().map(|answer| {
        answer
            .as_ref()
            .map(|facts| facts.all.as_slice())
            .map_err(|_| ())
    });
    ShelfPickerList {
        targets: picker_targets(shelves, viewer),
        viewer_id: viewer.map(|u| u.id),
        checked: facts.map(|f| f.manual_ids.clone()),
        busy: (picker.busy)(),
        error: (picker.error)(),
        automatic: facts
            .map(|f| f.named(&f.smart_ids).cloned().collect())
            .unwrap_or_default(),
    }
}

/// Builds the picker's tile handler: add this book to the shelf, or take it off
/// when it is already there, then patch the block's membership and the shelf's
/// count and ledge so the tile and the grid follow without a refetch. A
/// failure leaves both as they were.
fn build_shelf_toggle(
    server_url: String,
    uuid: String,
    has_cover: bool,
    shelves: Signal<ShelvesRead>,
    load_seq: Signal<u64>,
    picker: PickerState,
) -> EventHandler<i64> {
    EventHandler::new(move |shelf_id: i64| {
        let (mut shelves, mut busy, mut error) = (shelves, picker.busy, picker.error);
        if busy.peek().is_some() {
            return;
        }
        let Some(Ok(facts)) = shelves.peek().clone() else {
            return;
        };
        let adding = !facts.manual_ids.contains(&shelf_id);
        let name = facts
            .all
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
                    if let Some(Ok(facts)) = read {
                        facts.manual_ids = with_membership(&facts.manual_ids, shelf_id, adding);
                        facts.all =
                            with_member_summary(&facts.all, shelf_id, &uuid, has_cover, adding);
                    }
                }),
                Err(e) => error.set(Some(format!("Couldn\u{2019}t update {name}: {e}"))),
            }
            busy.set(None);
        });
    })
}

/// The button that opens the shelf picker, for a book on no shelf yet.
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

/// The dashed tile that ends the grid and opens the shelf picker.
fn add_to_shelf_tile(on_add: EventHandler<()>) -> Element {
    rsx! {
        button {
            r#type: "button",
            class: "shelf-add-tile bdmq-shelf-add",
            "data-testid": "bdmq-add-to-shelf",
            onclick: move |_| on_add.call(()),
            span { class: "shelf-add-tile-plus", {plus_icon()} }
            "Add to shelf"
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

/// `shelves` with `shelf_id`'s count and ledge following this book going onto
/// it (`on`) or coming off. A hand-picked shelf files new books last, so a
/// cover joins at the back, and only while the ledge has room; every other
/// shelf is left as it was.
fn with_member_summary(
    shelves: &[ShelfSummary],
    shelf_id: i64,
    uuid: &str,
    has_cover: bool,
    on: bool,
) -> Vec<ShelfSummary> {
    let mut next = shelves.to_vec();
    if let Some(shelf) = next.iter_mut().find(|s| s.id == shelf_id) {
        shelf.cover_uuids.retain(|c| c != uuid);
        if on {
            shelf.book_count += 1;
            if has_cover && shelf.cover_uuids.len() < LEDGE_BOOKS {
                shelf.cover_uuids.push(uuid.to_string());
            }
        } else {
            shelf.book_count = (shelf.book_count - 1).max(0);
        }
    }
    next
}

/// `shelf`, a Wishlist read before the book was wished for, with the book
/// counted in. A Wishlist lists newest first, so its cover leads the ledge.
fn with_wished_book(shelf: &ShelfSummary, uuid: &str, has_cover: bool) -> ShelfSummary {
    let mut next = shelf.clone();
    next.book_count += 1;
    if has_cover {
        next.cover_uuids.retain(|c| c != uuid);
        next.cover_uuids.insert(0, uuid.to_string());
        next.cover_uuids.truncate(LEDGE_BOOKS);
    }
    next
}

/// One held shelf: a tile linking to its page.
fn shelf_link_tile(shelf: &ShelfSummary, ctx: &BlockCtx) -> Element {
    let id = shelf.id;
    rsx! {
        Link {
            key: "{id}",
            to: Route::ShelfDetail { id },
            class: tile_class(true),
            style: accent_style(shelf),
            "aria-labelledby": "bdmq-shelf-name-{id}",
            "data-testid": "bdmq-shelf-{id}",
            ShelfTileFace {
                shelf: shelf.clone(),
                owner_label: viewer_owner_label(ctx.viewer_id, shelf),
                server_url: ctx.server_url.clone(),
                avatar_bust: ctx.avatar_bust,
                name_id: "bdmq-shelf-name-{id}",
            }
        }
    }
}

/// The membership block for the given shelves read: its kicker, then the tiles
/// ending in the Add-to-shelf tile, or the empty state with its button, or a
/// failure note, or a loader. "Not on a shelf yet." is only ever said of a
/// book no shelf of any kind holds; a series book on no shelf gets only the
/// button.
fn membership_body(
    held: Option<&Result<Vec<ShelfSummary>, ()>>,
    ctx: &BlockCtx,
    on_add: EventHandler<()>,
) -> Element {
    let (kicker_class, kicker) = if ctx.in_series {
        ("bdmq-k bdmq-k-below", "On your shelves")
    } else {
        ("bdmq-k", "Standalone \u{b7} on your shelves")
    };
    rsx! {
        div { class: kicker_class, "{kicker}" }
        match held {
            Some(Ok(held)) if !held.is_empty() => rsx! {
                div { class: "bdmq-shelves", "data-testid": "bdmq-shelves",
                    for shelf in held.iter() {
                        {shelf_link_tile(shelf, ctx)}
                    }
                    {add_to_shelf_tile(on_add)}
                }
            },
            Some(Ok(_)) => rsx! {
                if !ctx.in_series {
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
