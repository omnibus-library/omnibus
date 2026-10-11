//! Unit tests for the web landing body's bulk-save helpers: which lists a
//! save patches, and when it asks the filtered shelf list again.

use omnibus_shared::{FilterClause, FilterField, FilterMode, ViewFilters};

use super::*;
use crate::shelf_selection::ShelfSelection;
use crate::test_support::render_in_vdom;

fn book(uuid: &str, publisher: &str) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.to_string()),
        publisher: Some(publisher.to_string()),
        ..Default::default()
    }
}

fn publishers(list: &[EbookMetadata]) -> String {
    list.iter()
        .filter_map(|b| b.publisher.clone())
        .collect::<Vec<_>>()
        .join(",")
}

fn one_clause() -> ViewFilters {
    ViewFilters {
        clauses: vec![FilterClause::new(
            FilterField::Tag,
            FilterMode::Include,
            &["horror"],
        )],
    }
}

#[test]
fn narrowed_view_goes_stale_for_a_filtered_shelf_pick() {
    assert!(narrowed_view_goes_stale(
        ShelfSelection::Shelf(3),
        &one_clause()
    ));
}

#[test]
fn narrowed_view_stays_current_without_a_filter_or_a_shelf_pick() {
    assert!(!narrowed_view_goes_stale(
        ShelfSelection::Shelf(3),
        &ViewFilters::default()
    ));
    assert!(!narrowed_view_goes_stale(
        ShelfSelection::All,
        &one_clause()
    ));
}

fn lists_after_a_save() -> Element {
    let lists = BookLists {
        books: use_signal(|| vec![book("a", "Old"), book("c", "Keep")]),
        shelf_books: use_signal(|| Some(vec![book("a", "Old")])),
        shelf_view: use_signal(|| Some(vec![book("a", "Old")])),
        refetch_narrowed: None,
    };
    use_hook(|| install_updated_books(lists, &[book("a", "New")]));
    let browse = publishers(&lists.books.read());
    let full = publishers(lists.shelf_books.read().as_deref().unwrap_or_default());
    let narrowed = publishers(lists.shelf_view.read().as_deref().unwrap_or_default());
    rsx! { p { "browse={browse} full={full} narrowed={narrowed}" } }
}

#[test]
fn install_updated_books_patches_the_browse_and_both_shelf_lists() {
    let html = render_in_vdom(lists_after_a_save);

    assert!(
        html.contains("browse=New,Keep full=New narrowed=New"),
        "{html}"
    );
}

fn tick_after_a_save(refetch: bool) -> Element {
    let tick = use_signal(|| 0u32);
    let lists = BookLists {
        books: use_signal(Vec::new),
        shelf_books: use_signal(|| None),
        shelf_view: use_signal(|| None),
        refetch_narrowed: refetch.then_some(tick),
    };
    use_hook(|| lists.apply_bulk_save(&[]));
    rsx! { p { "tick={tick}" } }
}

#[test]
fn apply_bulk_save_asks_the_narrowed_list_again_when_it_may_have_gone_stale() {
    let html = render_in_vdom(|| tick_after_a_save(true));

    assert!(html.contains("tick=1"), "{html}");
}

#[test]
fn apply_bulk_save_leaves_the_narrowed_list_alone_otherwise() {
    let html = render_in_vdom(|| tick_after_a_save(false));

    assert!(html.contains("tick=0"), "{html}");
}
