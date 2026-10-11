//! Unit tests for the web shelf page's member section: its loading, empty,
//! filtered-out and failed states.

use omnibus_shared::{FilterClause, FilterField, FilterMode};

use crate::test_support::render_in_vdom;

use super::*;

fn view(pending: bool, filtered_out: bool) -> BooksView {
    BooksView {
        kind: ShelfKind::Manual,
        pending,
        books: Vec::new(),
        errored: false,
        filtered_out,
        unavailable: false,
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
fn shelf_books_keep_the_filter_bar_and_clear_all_beside_a_fetch_error() {
    // A filter the server refuses must never trap the reader.
    let html = render_in_vdom(|| {
        let mut failed = view(false, false);
        failed.errored = true;
        failed.filters = ViewFilters {
            clauses: vec![FilterClause::new(
                FilterField::Format,
                FilterMode::Include,
                &["pdf"],
            )],
        };
        rsx! { BooksHarness { view: failed } }
    });
    assert!(html.contains("shelf-refetch-error"), "{html}");
    assert!(html.contains("data-testid=\"lib-filter-bar\""), "{html}");
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
    let html = render_in_vdom(|| rsx! { BooksHarness { view: view(true, true) } });
    assert!(html.contains("shelf-loading"), "{html}");
    assert!(!html.contains("shelf-filtered-empty"), "{html}");
}

#[test]
fn shelf_books_count_zero_for_a_shelf_that_answered_empty() {
    let html = render_in_vdom(|| books(false));
    assert!(
        html.contains("data-testid=\"shelf-count\"") && html.contains(">0<"),
        "{html}"
    );
}

#[test]
fn shelf_books_show_no_count_for_the_placeholder_rows_of_a_failed_fetch() {
    let html = render_in_vdom(|| {
        let mut failed = view(false, false);
        failed.errored = true;
        failed.unavailable = true;
        rsx! { BooksHarness { view: failed } }
    });
    assert!(html.contains("shelf-refetch-error"), "{html}");
    assert!(!html.contains("data-testid=\"shelf-count\""), "{html}");
    assert!(!html.contains("shelf-count-pending"), "{html}");
}
