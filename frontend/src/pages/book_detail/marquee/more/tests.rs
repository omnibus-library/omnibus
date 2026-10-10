//! Tests for the More stop's shelf-membership block: the pure id-list update a
//! toggle applies, and what the block draws for each state of its shelves read.
//! Needs the `server` feature (`dioxus::ssr`).

use omnibus_shared::ShelfKind;

use super::*;
use crate::test_support::{render, test_shelf_summary};

#[test]
fn with_membership_appends_a_shelf_once() {
    assert_eq!(with_membership(&[4, 9], 2, true), vec![4, 9, 2]);
    assert_eq!(with_membership(&[4, 9], 9, true), vec![4, 9]);
}

#[test]
fn with_membership_removes_a_shelf_and_keeps_the_rest_in_order() {
    assert_eq!(with_membership(&[4, 9, 2], 9, false), vec![4, 2]);
    assert_eq!(with_membership(&[4, 2], 7, false), vec![4, 2]);
}

#[component]
fn Harness(held: Option<Result<Vec<ShelfSummary>, ()>>, in_series: bool) -> Element {
    membership_body(held.as_ref(), in_series, EventHandler::new(|_| {}))
}

/// The block for a standalone book.
fn block_html(held: Option<Result<Vec<ShelfSummary>, ()>>) -> String {
    render(rsx! { Harness { held, in_series: false } })
}

/// The block for a book that sits in a series.
fn series_block_html(held: Option<Result<Vec<ShelfSummary>, ()>>) -> String {
    render(rsx! { Harness { held, in_series: true } })
}

fn on_shelves(names: &[&str]) -> Option<Result<Vec<ShelfSummary>, ()>> {
    let shelves = names
        .iter()
        .zip(1..)
        .map(|(name, id)| test_shelf_summary(id, 7, ShelfKind::Manual, name))
        .collect();
    Some(Ok(shelves))
}

#[test]
fn membership_body_offers_add_to_shelf_to_a_book_on_no_shelf() {
    let html = block_html(on_shelves(&[]));
    assert!(html.contains("Not on a shelf yet."), "{html}");
    assert!(html.contains("data-testid=\"bdmq-add-to-shelf\""), "{html}");
    assert!(html.contains("Add to shelf"), "{html}");
    assert!(!html.contains("data-testid=\"bdmq-shelves\""), "{html}");
}

#[test]
fn membership_body_offers_add_to_shelf_beside_the_chips_of_a_book_on_shelves() {
    let html = block_html(on_shelves(&["Beach", "Commute"]));
    let chips_at = html
        .find("data-testid=\"bdmq-shelves\"")
        .unwrap_or_else(|| panic!("no chip row in {html}"));
    let chips_end = chips_at + html[chips_at..].find("</div>").expect("chip row closes");
    let chips = &html[chips_at..chips_end];
    assert!(
        chips.contains("Beach") && chips.contains("Commute"),
        "{html}"
    );
    assert!(!chips.contains("bdmq-add-to-shelf"), "{html}");
    assert!(html.contains("data-testid=\"bdmq-add-to-shelf\""), "{html}");
}

#[test]
fn membership_body_replaces_the_library_page_hints_with_the_button() {
    for held in [on_shelves(&[]), on_shelves(&["Beach"])] {
        let html = block_html(held);
        assert!(!html.contains("shelves are made on the"), "{html}");
        assert!(!html.contains("open a shelf from the"), "{html}");
    }
}

#[test]
fn membership_body_draws_a_loader_and_no_button_while_the_read_is_in_flight() {
    let html = block_html(None);
    assert!(
        html.contains("data-testid=\"bdmq-shelves-loading\""),
        "{html}"
    );
    assert!(!html.contains("bdmq-add-to-shelf"), "{html}");
    assert!(!html.contains("Not on a shelf yet."), "{html}");
}

// The unavailable hint links to the library page with a `dioxus_router::Link`,
// which panics without a live `RouterContext`; dioxus catches that per
// component, so only the link's own text is unverifiable here.
#[test]
fn membership_body_says_the_read_failed_and_offers_no_button() {
    let html = block_html(Some(Err(())));
    assert!(
        html.contains("data-testid=\"bdmq-shelves-unavailable\""),
        "{html}"
    );
    assert!(!html.contains("bdmq-add-to-shelf"), "{html}");
    assert!(!html.contains("Not on a shelf yet."), "{html}");
}

#[test]
fn membership_body_titles_a_standalone_books_block_standalone_on_your_shelves() {
    let html = block_html(on_shelves(&[]));
    assert!(html.contains("Standalone \u{b7} on your shelves"), "{html}");
}

#[test]
fn membership_body_titles_a_series_books_block_on_your_shelves() {
    let html = series_block_html(on_shelves(&[]));
    assert!(html.contains("On your shelves"), "{html}");
    assert!(!html.contains("Standalone"), "{html}");
}

#[test]
fn membership_body_offers_only_the_button_to_a_series_book_on_no_shelf() {
    let html = series_block_html(on_shelves(&[]));
    assert!(html.contains("data-testid=\"bdmq-add-to-shelf\""), "{html}");
    assert!(!html.contains("Not on a shelf yet."), "{html}");
    assert!(!html.contains("bdmq-bigquiet"), "{html}");
}

#[test]
fn membership_body_shows_a_series_books_chips_beside_the_button() {
    let html = series_block_html(on_shelves(&["Beach"]));
    assert!(html.contains("data-testid=\"bdmq-shelves\""), "{html}");
    assert!(html.contains("Beach"), "{html}");
    assert!(html.contains("data-testid=\"bdmq-add-to-shelf\""), "{html}");
}
