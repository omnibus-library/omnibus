//! Tests for the browse building blocks: a row's bar while progress is
//! pending, once it lands and when it never will; the Reading chip before
//! its count is known; the letter a key files under and the groups letters
//! make; and the reader's tally, book in progress, "read ago", meter and
//! cover bars over a pane.

use std::collections::HashMap;

use dioxus::prelude::*;
use omnibus_shared::{BookReading, BrowseSort, EbookMetadata, ReadStatus};

use super::books::{tile_fill, Tally};
use super::*;
use crate::test_support::{render, render_in_vdom};

const DAY: i64 = 86_400;

/// A state that has loaded, for the bar's ready branch.
fn ready() -> ListReading<HashMap<i64, ()>> {
    ListReading::Ready(HashMap::new())
}

#[test]
fn row_bar_draws_a_skeleton_until_progress_lands() {
    let pending: ListReading<()> = ListReading::Pending;
    let html = render(row_bar(4, None, &pending, "row-bar"));
    assert!(html.contains(r#"data-state="pending""#), "{html}");
    assert!(html.contains("ld-skel"), "{html}");
}

#[test]
fn row_bar_fills_finished_then_reading_by_share_of_books() {
    let html = render(row_bar(4, Some((1, 2)), &ready(), "row-bar"));
    assert!(html.contains(r#"data-state="ready""#), "{html}");
    assert!(html.contains("width: 25%"), "finished share: {html}");
    assert!(html.contains("width: 50%"), "reading share: {html}");
}

#[test]
fn row_bar_marks_progress_unknown_rather_than_empty_when_it_fails() {
    let failed: ListReading<()> = ListReading::Failed;
    let html = render(row_bar(4, None, &failed, "row-bar"));
    assert!(html.contains(r#"data-state="unknown""#), "{html}");
    assert!(html.contains("is-unknown"), "{html}");
}

const COPY: ListCopy = ListCopy {
    title: "Things",
    noun: "things",
    testid: "things",
    filter_placeholder: "Filter",
    filter_label: "Filter things",
    name_sort: "A\u{2013}Z",
};

/// The list head with the reader's in-progress count `reading_count`.
fn head(reading_count: Option<usize>) -> Element {
    rsx! {
        ListHead {
            copy: COPY,
            total: Some(3),
            filter: String::new(),
            sort: BrowseSort::Name,
            reading_count,
            only_reading: false,
            on_filter: move |_| {},
            on_sort: move |_| {},
            on_only_reading: move |_| {},
        }
    }
}

#[test]
fn reading_chip_is_inert_and_uncounted_until_progress_lands() {
    let html = render_in_vdom(|| head(None));
    assert!(html.contains("disabled"), "{html}");
    assert!(html.contains("ld-sheen"), "{html}");
    assert!(!html.contains(r#"<span class="au-chip-count">0"#), "{html}");
}

#[test]
fn reading_chip_shows_its_count_once_progress_lands() {
    let html = render_in_vdom(|| head(Some(2)));
    assert!(
        html.contains(r#"<span class="au-chip-count">2</span>"#),
        "{html}"
    );
    assert!(!html.contains("ld-sheen"), "{html}");
}

#[test]
fn list_head_names_its_test_ids_after_the_copy() {
    let html = render_in_vdom(|| head(Some(0)));
    for id in [
        "things-filter",
        "things-sort-name",
        "things-sort-recent",
        "things-reading-filter",
    ] {
        assert!(html.contains(id), "{id}: {html}");
    }
}

#[test]
fn letter_for_key_files_accented_and_non_latin_initials() {
    assert_eq!(letter_for_key("éluard, Paul"), 'E');
    assert_eq!(letter_for_key("1984"), '#');
    assert_eq!(letter_for_key("\u{4E2D}\u{6587}"), '#');
    assert_eq!(letter_for_key(""), '#');
}

#[test]
fn is_non_alpha_key_classifies_keys() {
    assert!(!is_non_alpha_key("Alcott, Louisa May"));
    assert!(!is_non_alpha_key("zZz"));
    assert!(is_non_alpha_key("1984"));
    assert!(is_non_alpha_key("[Anonymous]"));
    assert!(is_non_alpha_key("\u{4E2D}\u{6587}"));
    assert!(is_non_alpha_key(""));
}

#[test]
fn group_by_letter_merges_only_consecutive_rows_of_a_letter() {
    let groups = group_by_letter(&["Ant", "Ape", "Bee", "Asp"], |s| letter_for_key(s));
    let shape: Vec<(char, usize)> = groups.iter().map(|(l, g)| (*l, g.len())).collect();
    assert_eq!(shape, [('A', 2), ('B', 1), ('A', 1)]);
}

#[test]
fn letter_frag_spells_the_hash_bucket_out() {
    assert_eq!(letter_frag('#'), "hash");
    assert_eq!(letter_frag('Q'), "Q");
}

fn book(uuid: &str) -> EbookMetadata {
    EbookMetadata {
        title: Some(uuid.to_uppercase()),
        unique_identifier: Some(uuid.into()),
        ..Default::default()
    }
}

fn state(
    uuid: &str,
    status: ReadStatus,
    percent: Option<i64>,
    at: Option<i64>,
) -> (String, BookReading) {
    (
        uuid.into(),
        BookReading {
            book_uuid: uuid.into(),
            status,
            percent,
            last_read_at: at,
            ..Default::default()
        },
    )
}

#[test]
fn tally_counts_a_book_with_no_state_as_unread() {
    let books = [book("a"), book("b"), book("c")];
    let states: BookStates = [
        state("a", ReadStatus::Finished, None, Some(1)),
        state("b", ReadStatus::Reading, Some(40), Some(2)),
    ]
    .into();
    assert_eq!(
        tally(&books, &states),
        Tally {
            finished: 1,
            reading: 1,
            unread: 1
        }
    );
}

#[test]
fn current_book_is_the_book_in_progress_read_last() {
    let books = [book("a"), book("b"), book("c")];
    let states: BookStates = [
        state("a", ReadStatus::Reading, Some(10), Some(5)),
        state("b", ReadStatus::Reading, Some(80), Some(9)),
        state("c", ReadStatus::Finished, None, Some(20)),
    ]
    .into();
    let (current, _) = current_book(&books, &states).unwrap();
    assert_eq!(current.unique_identifier.as_deref(), Some("b"));
}

#[test]
fn current_book_is_none_when_nothing_is_in_progress() {
    let books = [book("a")];
    let states: BookStates = [state("a", ReadStatus::Finished, None, Some(1))].into();
    assert!(current_book(&books, &states).is_none());
}

#[test]
fn ago_steps_from_days_to_weeks_months_and_years() {
    let utc = Some(0);
    assert_eq!(ago(DAY / 2, 0, utc), "today");
    assert_eq!(ago(DAY, 0, utc), "yesterday");
    assert_eq!(ago(20 * DAY, 0, utc), "2 weeks ago");
    assert_eq!(ago(95 * DAY, 0, utc), "3 months ago");
    assert_eq!(ago(800 * DAY, 0, utc), "2 years ago");
}

#[test]
fn ago_counts_calendar_days_in_the_readers_zone() {
    // 23:00 then 08:00 the next morning is yesterday, not today.
    assert_eq!(ago(DAY + 8 * 3_600, 23 * 3_600, Some(0)), "yesterday");
    // 18:00 and 20:00 at UTC-5 are one evening, though UTC midnight falls between.
    let at = |h: i64| DAY + h * 3_600 + 5 * 3_600;
    assert_eq!(ago(at(20), at(18), Some(-5 * 3_600)), "today");
}

#[test]
fn ago_counts_whole_days_when_the_zone_is_unknown() {
    assert_eq!(ago(DAY + 8 * 3_600, 23 * 3_600, None), "today");
    assert_eq!(ago(2 * DAY, 0, None), "2 days ago");
}

#[test]
fn books_meta_adds_finished_only_when_there_is_some() {
    let books = [book("a"), book("b")];
    assert_eq!(books_meta(&books, &BookStates::new()), "2 books");
    let one: BookStates = [state("a", ReadStatus::Finished, None, Some(1))].into();
    assert_eq!(books_meta(&books, &one), "2 books \u{b7} 1 finished");
}

#[test]
fn tile_fill_is_full_when_finished_a_sliver_at_least_while_reading_and_none_unread() {
    let states: BookStates = [
        state("done", ReadStatus::Finished, Some(40), Some(1)),
        state("new", ReadStatus::Reading, None, Some(2)),
        state("mid", ReadStatus::Reading, Some(42), Some(3)),
    ]
    .into();
    assert_eq!(tile_fill(&book("done"), &states), Some(100));
    assert_eq!(tile_fill(&book("new"), &states), Some(3));
    assert_eq!(tile_fill(&book("mid"), &states), Some(42));
    assert_eq!(tile_fill(&book("unread"), &states), None);
}

#[test]
fn progress_meter_sizes_finished_then_reading_and_says_both() {
    let t = Tally {
        finished: 1,
        reading: 2,
        unread: 1,
    };
    let html = render(progress_meter(4, t));
    assert!(html.contains("1 of 4 finished, 2 reading"), "{html}");
    assert!(html.contains("width: 25%"), "finished share: {html}");
    assert!(html.contains("width: 50%"), "reading share: {html}");
}
