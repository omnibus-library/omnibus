//! Web shelf page: the way back to the index, the hero (see
//! [`super::header`]), and the member books — a sort control on smart
//! shelves, the cover grid with a remove control on each book the viewer may
//! take off, and empty states that say what fills this kind of shelf. Draws
//! only once the viewer is known, so the actions never render enabled and then
//! grey out.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{EbookMetadata, Shelf, ShelfKind, SortKey, ViewFilters};

use super::header::ShelfHero;
use super::narrow::{use_narrowing, FullList};
use crate::components::atrium::fallback_title;
use crate::components::loading::CoverSkeletons;
use crate::components::shelf_glyphs::{plus_icon, x_icon};
use crate::components::{CoverTile, CoverTileKind, FilterBar, Loading, LoadingKind, ShelfList};
use crate::shelf_access::ShelfAccess;
use crate::{data, Route};

/// UI-state signals the page owns and this surface drives. `Copy` (Dioxus
/// signals), so grouping them keeps the props list short.
#[derive(Clone, Copy, PartialEq)]
pub(super) struct ShelfBodySignals {
    pub sort_key: Signal<SortKey>,
    pub show_add: Signal<bool>,
    pub edit_shelf: Signal<bool>,
    pub reload: Signal<u32>,
}

/// The web shelf page — see the module doc. `books` is the shelf's full member
/// list; the rows drawn are that list narrowed by the saved library filter.
#[component]
pub(super) fn WebShelfBody(
    shelf: Shelf,
    books: Vec<EbookMetadata>,
    errored: bool,
    members_ready: bool,
    server_url: String,
    signals: ShelfBodySignals,
) -> Element {
    let ShelfBodySignals {
        sort_key,
        mut show_add,
        mut edit_shelf,
        mut reload,
    } = signals;
    let narrowing = use_narrowing(shelf.id, server_url.clone(), sort_key, reload);
    let viewer_probe = crate::use_current_user().0;
    // Books whose removal is in flight, or has landed but not yet been
    // refetched away: dimmed and inert until the next member list arrives.
    let mut leaving = use_signal(Vec::<String>::new);
    let mut remove_error = use_signal(|| None::<String>);
    use_effect(use_reactive!(|books| {
        let _ = books;
        if !leaving.peek().is_empty() {
            leaving.set(Vec::new());
        }
    }));

    let Some(viewer) = viewer_probe() else {
        return rsx! {
            div { class: "shd-page",
                {back_crumb()}
                div { class: "shd-state", Loading { kind: LoadingKind::Page, label: "Opening the shelf" } }
            }
        };
    };
    let access = ShelfAccess::resolve(
        viewer.as_ref(),
        shelf.owner_user_id,
        &shelf.owner_username,
        shelf.kind,
    );
    let accent = shelf
        .accent
        .clone()
        .unwrap_or_else(|| "var(--accent)".into());
    let shelf_id = shelf.id;
    let remove_url = server_url.clone();
    let on_remove = EventHandler::new(move |(uuid, title): (String, String)| {
        if leaving.peek().contains(&uuid) {
            return;
        }
        leaving.write().push(uuid.clone());
        remove_error.set(None);
        let url = remove_url.clone();
        spawn(async move {
            match data::remove_shelf_book(&url, shelf_id, &uuid).await {
                Ok(()) => reload.with_mut(|n| *n += 1),
                Err(e) => {
                    leaving.write().retain(|u| *u != uuid);
                    remove_error.set(Some(format!(
                        "Couldn\u{2019}t remove \u{201c}{title}\u{201d} from this shelf: {e}"
                    )));
                }
            }
        });
    });
    let rows = narrowing.rows(FullList {
        books: &books,
        ready: members_ready,
        errored,
    });
    let view = BooksView {
        kind: shelf.kind,
        pending: rows.pending,
        books: rows.books,
        errored: rows.errored,
        filtered_out: rows.filtered_out,
        server_url,
        can_edit: access.can_edit(),
        leaving: leaving(),
        remove_error: remove_error(),
        filters: (narrowing.filters)(),
        shelves: (narrowing.shelves)(),
        viewer_id: viewer.as_ref().map(|u| u.id),
    };

    rsx! {
        div {
            class: "shd-page",
            style: "--shelf-accent: {accent};",
            "data-testid": "shelf-detail",
            {back_crumb()}
            ShelfHero {
                shelf: shelf.clone(),
                access,
                members_ready,
                on_add: move |_| show_add.set(true),
                on_edit: move |_| edit_shelf.set(true),
                on_changed: move |_| reload.with_mut(|n| *n += 1),
            }
            ShelfBooks {
                view,
                sort_key,
                on_add: move |_| show_add.set(true),
                on_edit: move |_| edit_shelf.set(true),
                on_remove,
                on_filters: move |next| narrowing.set_filters(next),
            }
        }
    }
}

/// The way back to the index, above every state of the page.
pub(super) fn back_crumb() -> Element {
    rsx! {
        nav { class: "shd-crumbs", "aria-label": "Breadcrumb",
            Link { to: Route::Shelves {}, class: "shd-back", "data-testid": "shelf-back",
                "\u{2190} All shelves"
            }
        }
    }
}

/// What the member section renders from.
#[derive(Clone, PartialEq)]
struct BooksView {
    kind: ShelfKind,
    /// No member list has answered yet — neither a count nor "empty" is known.
    pending: bool,
    books: Vec<EbookMetadata>,
    errored: bool,
    server_url: String,
    /// The viewer may change this shelf's membership or rules.
    can_edit: bool,
    /// Uuids of books being taken off the shelf.
    leaving: Vec<String>,
    remove_error: Option<String>,
    /// The shelf holds books, but the filter rules every one out.
    filtered_out: bool,
    /// The library filter the books were narrowed by, and what its chips name.
    filters: ViewFilters,
    shelves: ShelfList,
    viewer_id: Option<i64>,
}

/// The member books: heading and count, the smart-shelf sort, the filter bar,
/// any fetch or removal failure, then the grid — or an empty state in the
/// kind's terms.
#[component]
fn ShelfBooks(
    view: BooksView,
    sort_key: Signal<SortKey>,
    on_add: EventHandler<()>,
    on_edit: EventHandler<()>,
    on_remove: EventHandler<(String, String)>,
    on_filters: EventHandler<ViewFilters>,
) -> Element {
    let removable = view.can_edit && view.kind == ShelfKind::Manual;
    let count = view.books.len();
    rsx! {
        section { class: "shd-books", "aria-labelledby": "shd-books-title",
            div { class: "shd-books-head",
                h2 { class: "shd-books-title", id: "shd-books-title",
                    "Books"
                    if view.pending {
                        span { class: "mono shd-books-count ld-sheen", "data-testid": "shelf-count-pending", "counting" }
                    } else {
                        span { class: "mono shd-books-count", "data-testid": "shelf-count", "{count}" }
                    }
                }
                if view.kind == ShelfKind::Smart {
                    {sort_control(sort_key)}
                }
            }
            FilterBar {
                filters: view.filters.clone(),
                shelves: view.shelves.clone(),
                viewer_id: view.viewer_id,
                on_change: on_filters,
            }
            if view.errored {
                p { role: "alert", class: "error shd-alert", "data-testid": "shelf-refetch-error",
                    "Couldn\u{2019}t refresh this shelf. Check your connection and try again."
                }
            }
            if let Some(msg) = view.remove_error.clone() {
                p { role: "alert", class: "error shd-alert", "data-testid": "shelf-remove-error", "{msg}" }
            }
            if view.pending {
                div { class: "shd-grid-pending", role: "status", "aria-live": "polite", "data-testid": "shelf-loading",
                    span { class: "ld-sr", "Taking the books off the shelf" }
                    CoverSkeletons { count: 6 }
                }
            } else if view.filtered_out {
                {filtered_empty_state(on_filters)}
            } else if view.books.is_empty() && !view.errored {
                {empty_state(view.kind, view.can_edit, on_add, on_edit)}
            } else {
                div { class: "lib-grid shelf-grid shd-grid", "data-testid": "shelf-grid", role: "list",
                    for book in view.books.iter().cloned() {
                        {member_tile(book, &view.server_url, removable, &view.leaving, on_remove)}
                    }
                    if removable {
                        button {
                            r#type: "button",
                            class: "shelf-add-tile",
                            "data-testid": "shelf-add-tile",
                            onclick: move |_| on_add.call(()),
                            span { class: "shelf-add-tile-plus", {plus_icon()} }
                            span { "Add books" }
                        }
                    }
                }
            }
        }
    }
}

/// Sort for a smart shelf — the only kind whose order the server computes.
fn sort_control(mut sort_key: Signal<SortKey>) -> Element {
    rsx! {
        label { class: "shd-sort",
            span { class: "label", "Sort" }
            select {
                class: "shelf-select",
                "data-testid": "shelf-sort",
                value: sort_key().as_wire(),
                onchange: move |e| {
                    if let Some(k) = SortKey::from_wire(&e.value()) {
                        sort_key.set(k);
                    }
                },
                option { value: "recently_interacted", "Recently read" }
                option { value: "title", "Title" }
                option { value: "author", "Author" }
                option { value: "series", "Series" }
                option { value: "newest_added", "Newest added" }
                option { value: "last_updated", "Recently updated" }
            }
        }
    }
}

/// One member: its cover tile, plus — when the viewer may take it off — a
/// remove control that names the book it removes.
fn member_tile(
    book: EbookMetadata,
    server_url: &str,
    removable: bool,
    leaving: &[String],
    on_remove: EventHandler<(String, String)>,
) -> Element {
    // Match `Cover`'s empty-title handling (issue #92): blank titles fall back
    // to the filename so the caption and both labels never render empty.
    let title = fallback_title(book.title.as_deref(), &book.filename);
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let is_leaving = leaving.contains(&uuid);
    let key = book.id;
    let remove_label = format!("Remove {title} from this shelf");
    rsx! {
        div {
            key: "{key}",
            class: if is_leaving { "shd-tile shd-tile--leaving" } else { "shd-tile" },
            CoverTile {
                book,
                server_url: server_url.to_string(),
                sizes: "(max-width: 640px) 160px, 200px".to_string(),
                kind: CoverTileKind::MemberLink { title: title.clone() },
            }
            if removable {
                button {
                    r#type: "button",
                    class: "shd-tile-remove",
                    "data-testid": "shelf-remove-{uuid}",
                    "aria-label": "{remove_label}",
                    title: "Remove from shelf",
                    disabled: is_leaving,
                    onclick: move |_| on_remove.call((uuid.clone(), title.clone())),
                    {x_icon()}
                }
            }
        }
    }
}

/// What a shelf says when the filter rules out every book it holds, with the
/// way back to all of them.
fn filtered_empty_state(on_filters: EventHandler<ViewFilters>) -> Element {
    rsx! {
        div { class: "shd-empty", "data-testid": "shelf-filtered-empty",
            p { class: "shd-empty-msg", "No books on this shelf match these filters." }
            button {
                r#type: "button",
                class: "btn",
                "data-testid": "shelf-filtered-clear",
                onclick: move |_| on_filters.call(ViewFilters::default()),
                "Clear filters"
            }
        }
    }
}

/// What an empty shelf says, in its kind's terms, with the one action that
/// would fill it when the viewer may take it.
fn empty_state(
    kind: ShelfKind,
    can_edit: bool,
    on_add: EventHandler<()>,
    on_edit: EventHandler<()>,
) -> Element {
    let message = match kind {
        ShelfKind::Manual => "No books on this shelf yet.",
        ShelfKind::Smart => "No books match this shelf\u{2019}s rules yet.",
        ShelfKind::Wishlist => "Nothing on this wishlist yet.",
    };
    rsx! {
        div { class: "shd-empty", "data-testid": "shelf-empty",
            p { class: "shd-empty-msg", "{message}" }
            if can_edit && kind == ShelfKind::Manual {
                button {
                    r#type: "button",
                    class: "btn primary",
                    "data-testid": "shelf-empty-add",
                    onclick: move |_| on_add.call(()),
                    {plus_icon()}
                    "Add books"
                }
            } else if can_edit && kind == ShelfKind::Smart {
                button {
                    r#type: "button",
                    class: "btn",
                    "data-testid": "shelf-empty-edit",
                    onclick: move |_| on_edit.call(()),
                    "Edit rules"
                }
            }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests {
    use omnibus_shared::{FilterClause, FilterField, FilterMode};

    use super::*;
    use crate::test_support::render_in_vdom;

    fn view(pending: bool, filtered_out: bool) -> BooksView {
        BooksView {
            kind: ShelfKind::Manual,
            pending,
            books: Vec::new(),
            errored: false,
            filtered_out,
            server_url: String::new(),
            can_edit: false,
            leaving: Vec::new(),
            remove_error: None,
            filters: ViewFilters::default(),
            shelves: ShelfList::Pending,
            viewer_id: None,
        }
    }

    #[component]
    fn BooksHarness(view: BooksView) -> Element {
        let sort_key = use_signal(|| SortKey::Title);
        rsx! {
            ShelfBooks {
                view,
                sort_key,
                on_add: EventHandler::new(|_| {}),
                on_edit: EventHandler::new(|_| {}),
                on_remove: EventHandler::new(|_| {}),
                on_filters: EventHandler::new(|_| {}),
            }
        }
    }

    fn books(pending: bool) -> Element {
        rsx! { BooksHarness { view: view(pending, false) } }
    }

    #[test]
    fn shelf_books_hold_skeletons_rather_than_the_empty_state_before_members_answer() {
        let html = render_in_vdom(|| books(true));
        assert!(html.contains("shelf-loading"), "{html}");
        assert!(html.contains("shelf-count-pending"), "{html}");
        assert!(!html.contains("shelf-empty"), "{html}");
    }

    #[test]
    fn shelf_books_say_the_shelf_is_empty_once_members_answer_with_none() {
        let html = render_in_vdom(|| books(false));
        assert!(html.contains("shelf-empty"), "{html}");
        assert!(!html.contains("shelf-loading"), "{html}");
    }

    #[test]
    fn shelf_books_render_the_filter_bar_beside_the_member_count() {
        let html = render_in_vdom(|| books(false));
        assert!(html.contains("data-testid=\"lib-filter-bar\""), "{html}");
        assert!(html.contains("data-testid=\"filter-add\""), "{html}");
    }

    #[test]
    fn shelf_books_draw_a_chip_for_a_filter_the_landing_page_saved() {
        let html = render_in_vdom(|| {
            let mut filtered = view(false, false);
            filtered.filters = ViewFilters {
                clauses: vec![FilterClause::new(
                    FilterField::Format,
                    FilterMode::Exclude,
                    &["pdf"],
                )],
            };
            rsx! { BooksHarness { view: filtered } }
        });
        assert!(html.contains("Format excludes any of PDF"), "{html}");
        assert!(html.contains("data-testid=\"filter-clear-all\""), "{html}");
    }

    #[test]
    fn shelf_books_say_the_filter_ruled_every_member_out_rather_than_that_the_shelf_is_empty() {
        let html = render_in_vdom(|| rsx! { BooksHarness { view: view(false, true) } });
        assert!(html.contains("shelf-filtered-empty"), "{html}");
        assert!(
            html.contains("No books on this shelf match these filters."),
            "{html}"
        );
        assert!(!html.contains("data-testid=\"shelf-empty\""), "{html}");
    }

    #[test]
    fn shelf_books_hold_skeletons_rather_than_the_filtered_message_before_members_answer() {
        let html = render_in_vdom(|| rsx! { BooksHarness { view: view(true, false) } });
        assert!(!html.contains("shelf-filtered-empty"), "{html}");
    }
}
