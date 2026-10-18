//! Unit tests for the landing page's pure view derivations: which list feeds
//! the grid, what the section header is titled, and where its count comes
//! from.

use omnibus_shared::{FilterClause, FilterField, FilterMode, ShelfKind, ShelfSummary, Visibility};

use super::*;

fn shelf(id: i64, name: &str, book_count: i64) -> ShelfSummary {
    ShelfSummary {
        id,
        owner_user_id: 1,
        owner_username: "elena".into(),
        owner_has_avatar: false,
        kind: ShelfKind::Manual,
        name: name.into(),
        visibility: Visibility::Private,
        accent: None,
        book_count,
        cover_uuids: Vec::new(),
    }
}

#[test]
fn visible_source_ranks_a_shelf_pick_over_browse() {
    assert_eq!(
        visible_source(ShelfSelection::Shelf(7)),
        VisibleSource::Shelf
    );
    assert_eq!(visible_source(ShelfSelection::All), VisibleSource::Browse);
}

#[test]
fn shelf_book_count_prefers_the_loaded_member_list_over_the_gallery_summary() {
    // The summary's aggregate is stale after a membership change; the member
    // list is the one that refetched, so the header must follow it.
    let shelves = vec![shelf(7, "Lunch Break Picks", 3)];
    assert_eq!(
        shelf_book_count(ShelfSelection::Shelf(7), &shelves, Some(4), false),
        Some(4)
    );
    assert_eq!(
        shelf_book_count(ShelfSelection::Shelf(7), &shelves, Some(0), false),
        Some(0)
    );
}

#[test]
fn shelf_book_count_stands_in_with_the_summary_until_the_members_land() {
    let shelves = vec![shelf(7, "Lunch Break Picks", 3)];
    assert_eq!(
        shelf_book_count(ShelfSelection::Shelf(7), &shelves, None, false),
        Some(3)
    );
    // A pick whose shelf isn't in the (still-loading) list is unknown, not a
    // guessed zero.
    assert_eq!(
        shelf_book_count(ShelfSelection::Shelf(9), &shelves, None, false),
        None
    );
    assert_eq!(
        shelf_book_count(ShelfSelection::All, &shelves, None, false),
        None
    );
}

#[test]
fn shelf_book_count_is_the_filtered_member_count_under_a_filter() {
    let shelves = vec![shelf(7, "Lunch Break Picks", 3)];
    assert_eq!(
        shelf_book_count(ShelfSelection::Shelf(7), &shelves, Some(1), true),
        Some(1)
    );
}

#[test]
fn shelf_book_count_never_stands_in_with_the_unfiltered_summary_under_a_filter() {
    // The gallery summary counts the whole shelf; showing it beside a filter
    // chip would report a figure the grid is not about to match.
    let shelves = vec![shelf(7, "Lunch Break Picks", 3)];
    assert_eq!(
        shelf_book_count(ShelfSelection::Shelf(7), &shelves, None, true),
        None
    );
}

fn series_book(uuid: &str, series: &str, index: &str) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.into()),
        series: Some(series.into()),
        series_index: Some(index.into()),
        ..Default::default()
    }
}

#[test]
fn shelf_lens_stacks_the_members_only_with_stacking_on() {
    let members = vec![
        series_book("a", "Saga", "1"),
        series_book("b", "Saga", "2"),
        series_book("c", "Other", "1"),
    ];

    let (rows, stacks) = shelf_lens(&members, true);
    let uuids: Vec<_> = rows
        .iter()
        .filter_map(|b| b.unique_identifier.as_deref())
        .collect();
    assert_eq!(uuids, vec!["a", "c"]);
    assert_eq!(stacks.len(), 1);
    assert!(
        stacks[0].states.is_empty(),
        "a shelf page carries no reading state"
    );

    let (rows, stacks) = shelf_lens(&members, false);
    assert_eq!(rows.len(), 3);
    assert!(stacks.is_empty());
}

fn one_clause() -> ViewFilters {
    ViewFilters {
        clauses: vec![FilterClause::new(
            FilterField::Format,
            FilterMode::Include,
            &["pdf"],
        )],
    }
}

#[test]
fn books_empty_is_true_for_an_empty_browse_list_fetched_with_no_filter() {
    assert!(books_empty(
        VisibleSource::Browse,
        true,
        false,
        &ViewFilters::default()
    ));
}

#[test]
fn books_empty_is_false_for_an_empty_browse_list_fetched_under_a_filter() {
    assert!(!books_empty(
        VisibleSource::Browse,
        true,
        false,
        &one_clause()
    ));
}

#[test]
fn books_empty_is_false_when_browse_books_are_visible() {
    assert!(!books_empty(
        VisibleSource::Browse,
        false,
        false,
        &ViewFilters::default()
    ));
    assert!(!books_empty(
        VisibleSource::Browse,
        false,
        false,
        &one_clause()
    ));
}

#[test]
fn books_empty_is_true_for_an_empty_shelf_even_with_a_filter() {
    assert!(books_empty(VisibleSource::Shelf, true, true, &one_clause()));
    assert!(books_empty(
        VisibleSource::Shelf,
        true,
        true,
        &ViewFilters::default()
    ));
}

#[test]
fn books_empty_is_false_when_a_filter_ruled_every_shelf_member_out() {
    assert!(!books_empty(
        VisibleSource::Shelf,
        true,
        false,
        &one_clause()
    ));
}

fn members(uuids: &[&str]) -> Option<Vec<EbookMetadata>> {
    Some(
        uuids
            .iter()
            .map(|u| EbookMetadata {
                unique_identifier: Some((*u).into()),
                ..Default::default()
            })
            .collect(),
    )
}

fn uuids_of(rows: &Option<Vec<EbookMetadata>>) -> Vec<&str> {
    rows.iter()
        .flatten()
        .filter_map(|b| b.unique_identifier.as_deref())
        .collect()
}

#[test]
fn shelf_rows_draws_from_the_full_member_list_when_no_filter_is_set() {
    let full = members(&["a", "b", "c"]);
    let narrowed = members(&["b"]);
    assert_eq!(
        uuids_of(shelf_rows(false, &full, &narrowed)),
        vec!["a", "b", "c"]
    );
}

#[test]
fn shelf_rows_draws_from_the_narrowed_list_under_a_filter() {
    let full = members(&["a", "b", "c"]);
    let narrowed = members(&["b"]);
    assert_eq!(uuids_of(shelf_rows(true, &full, &narrowed)), vec!["b"]);
}

#[test]
fn shelf_rows_is_unanswered_under_a_filter_until_the_narrowed_list_lands() {
    // The full list being loaded must not be shown as if it were the answer.
    let full = members(&["a", "b", "c"]);
    assert!(shelf_rows(true, &full, &None).is_none());
}

#[test]
fn shelf_members_empty_reads_the_full_list() {
    assert!(shelf_members_empty(members(&[]).as_ref(), false, false));
    assert!(!shelf_members_empty(members(&["a"]).as_ref(), false, false));
    // A filter that rules everything out does not empty the shelf itself.
    assert!(!shelf_members_empty(members(&["a"]).as_ref(), true, false));
    assert!(shelf_members_empty(members(&[]).as_ref(), true, false));
}

#[test]
fn shelf_members_empty_is_false_while_the_full_list_is_unanswered_under_a_filter() {
    // The narrowed list can land first; an empty one is then "nothing matches",
    // not "the shelf holds nothing".
    assert!(!shelf_members_empty(None, true, false));
}

#[test]
fn narrowed_for_withholds_an_answer_fetched_under_other_filters() {
    let kept = members(&[]);

    let got = narrowed_for(&kept, &one_clause(), &ViewFilters::default());

    assert!(got.is_none());
}

#[test]
fn narrowed_for_returns_the_answer_fetched_under_the_filters_asked_for() {
    let kept = members(&["a"]);

    let got = narrowed_for(&kept, &one_clause(), &one_clause());

    assert_eq!(uuids_of(got), vec!["a"]);
}

fn failed(message: &str) -> Option<String> {
    Some(message.to_string())
}

#[test]
fn shelf_error_reads_the_full_list_failure_when_no_filter_is_set() {
    let got = shelf_error(false, failed("full"), failed("narrowed"), true);

    assert_eq!(got.as_deref(), Some("full"));
}

#[test]
fn shelf_error_reads_the_narrowed_failure_under_a_filter() {
    let got = shelf_error(true, None, failed("narrowed"), true);

    assert_eq!(got.as_deref(), Some("narrowed"));
}

#[test]
fn shelf_error_ignores_a_narrowed_failure_fetched_under_other_filters() {
    let got = shelf_error(true, None, failed("narrowed"), false);

    assert_eq!(got, None);
}

#[test]
fn shelf_error_leaves_a_full_list_failure_off_a_narrowed_answer_that_landed() {
    // The rows on screen answer the filter; the failed list only matters to Add books.
    let got = shelf_error(true, failed("full"), None, true);

    assert_eq!(got, None);
}

#[test]
fn shelf_members_empty_is_false_for_the_placeholder_a_failed_full_list_leaves() {
    // Its empty list is not a claim that the shelf holds nothing.
    assert!(!shelf_members_empty(members(&[]).as_ref(), true, true));
}

#[test]
fn shelf_members_state_reads_a_failure_over_a_kept_answer() {
    assert_eq!(shelf_members_state(true, true, true), Members::Unavailable);
}

#[test]
fn shelf_members_state_is_ready_once_the_full_list_answered_without_error() {
    assert_eq!(shelf_members_state(true, false, true), Members::Ready);
}

#[test]
fn shelf_members_state_is_pending_until_the_full_list_answers_and_off_a_shelf() {
    assert_eq!(shelf_members_state(true, false, false), Members::Pending);
    assert_eq!(shelf_members_state(false, true, true), Members::Pending);
}
