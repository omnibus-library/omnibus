//! Unit tests for which member list the web shelf page draws and what an empty
//! one means.

use super::*;

fn books(uuids: &[&str]) -> Vec<EbookMetadata> {
    uuids
        .iter()
        .map(|u| EbookMetadata {
            unique_identifier: Some((*u).into()),
            ..Default::default()
        })
        .collect()
}

fn uuids(rows: &Rows) -> Vec<&str> {
    rows.books
        .iter()
        .filter_map(|b| b.unique_identifier.as_deref())
        .collect()
}

fn full(list: &[EbookMetadata], ready: bool, errored: bool) -> FullList<'_> {
    FullList {
        books: list,
        ready,
        errored,
    }
}

fn answered(list: Option<&[EbookMetadata]>, failed: bool) -> NarrowedList<'_> {
    NarrowedList {
        books: list,
        failed,
        current: true,
    }
}

#[test]
fn rows_draw_the_full_list_when_no_filter_is_set() {
    let list = books(&["a", "b"]);

    let got = rows(false, full(&list, true, false), answered(None, false));

    assert_eq!(uuids(&got), vec!["a", "b"]);
    assert!(!got.pending && !got.errored && !got.filtered_out);
}

#[test]
fn rows_are_pending_until_the_full_list_first_answers() {
    let got = rows(false, full(&[], false, false), answered(None, false));

    assert!(got.pending);
}

#[test]
fn rows_are_not_pending_once_the_full_list_failed() {
    let got = rows(false, full(&[], false, true), answered(None, false));

    assert!(!got.pending);
    assert!(got.errored);
}

#[test]
fn rows_draw_the_narrowed_list_under_a_filter() {
    let list = books(&["a", "b", "c"]);
    let narrowed = books(&["b"]);

    let got = rows(
        true,
        full(&list, true, false),
        answered(Some(&narrowed), false),
    );

    assert_eq!(uuids(&got), vec!["b"]);
    assert!(!got.pending && !got.filtered_out);
}

#[test]
fn rows_are_pending_under_a_filter_until_the_narrowed_list_lands() {
    // The full list is on hand, but it is not the answer to the filter.
    let list = books(&["a", "b", "c"]);

    let got = rows(true, full(&list, true, false), answered(None, false));

    assert!(got.pending);
    assert!(got.books.is_empty());
    assert!(!got.filtered_out);
}

#[test]
fn rows_say_the_filter_ruled_every_member_out_when_the_shelf_holds_books() {
    let list = books(&["a", "b"]);

    let got = rows(true, full(&list, true, false), answered(Some(&[]), false));

    assert!(got.filtered_out);
    assert!(!got.pending);
}

#[test]
fn rows_say_the_filter_ruled_everything_out_while_the_full_list_is_unanswered() {
    // Nothing matches either way; the shelf's own emptiness is not yet known.
    let got = rows(true, full(&[], false, false), answered(Some(&[]), false));

    assert!(got.filtered_out);
}

#[test]
fn rows_leave_an_empty_shelf_to_its_own_empty_state_under_a_filter() {
    let got = rows(true, full(&[], true, false), answered(Some(&[]), false));

    assert!(!got.filtered_out);
    assert!(!got.pending);
}

#[test]
fn rows_report_a_failed_narrowed_fetch_as_an_error_not_as_a_filtered_out_shelf() {
    let list = books(&["a"]);

    let got = rows(true, full(&list, true, false), answered(Some(&[]), true));

    assert!(got.errored);
    assert!(!got.filtered_out);
    assert!(!got.pending);
}

#[test]
fn rows_report_a_failed_full_list_under_a_filter() {
    let narrowed = books(&["a"]);

    let got = rows(
        true,
        full(&[], false, true),
        answered(Some(&narrowed), false),
    );

    assert!(got.errored);
    assert_eq!(uuids(&got), vec!["a"]);
}

fn stale(list: Option<&[EbookMetadata]>, failed: bool) -> NarrowedList<'_> {
    NarrowedList {
        books: list,
        failed,
        current: false,
    }
}

#[test]
fn rows_are_pending_under_a_filter_while_the_narrowed_answer_belongs_to_other_filters() {
    let list = books(&["a", "b"]);

    let got = rows(true, full(&list, true, false), stale(Some(&[]), false));

    assert!(got.pending);
    assert!(got.books.is_empty());
    assert!(!got.filtered_out);
}

#[test]
fn rows_leave_out_a_narrowed_failure_that_belongs_to_other_filters() {
    let list = books(&["a"]);

    let got = rows(true, full(&list, true, false), stale(Some(&[]), true));

    assert!(!got.errored);
    assert!(!got.unavailable);
}

#[test]
fn rows_are_unavailable_when_the_narrowed_fetch_failed() {
    let list = books(&["a"]);

    let got = rows(true, full(&list, true, false), answered(Some(&[]), true));

    assert!(got.unavailable);
}

#[test]
fn rows_are_unavailable_when_the_full_list_failed_and_no_filter_is_set() {
    let got = rows(false, full(&[], false, true), answered(None, false));

    assert!(got.unavailable);
}

#[test]
fn rows_stay_available_when_only_the_full_list_failed_under_a_filter() {
    let narrowed = books(&["a"]);

    let got = rows(
        true,
        full(&[], false, true),
        answered(Some(&narrowed), false),
    );

    assert!(!got.unavailable);
}

#[test]
fn rows_are_available_when_nothing_failed() {
    let list = books(&["a"]);

    let got = rows(false, full(&list, true, false), answered(None, false));

    assert!(!got.unavailable);
}
