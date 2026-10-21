//! Tests for the author pane's pure helpers: the reading tally and the book
//! in progress, the meta lines, and shelving books by series.

use omnibus_shared::{BookReading, EbookMetadata, ReadStatus};

use super::hero::hero_meta;
use super::progress::{ago, current_book, current_meta, tally, Tally};
use super::shelf::{group_by_series, series_count, shelf_meta};
use super::BookStates;

const DAY: i64 = 86_400;

fn book(uuid: &str, series: Option<(&str, &str)>) -> EbookMetadata {
    EbookMetadata {
        title: Some(uuid.to_uppercase()),
        unique_identifier: Some(uuid.into()),
        series: series.map(|(s, _)| s.into()),
        series_index: series.map(|(_, i)| i.into()),
        series_id: series.map(|_| 7),
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
    let books = [book("a", None), book("b", None), book("c", None)];
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
    let books = [book("a", None), book("b", None), book("c", None)];
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
    let books = [book("a", None)];
    let states: BookStates = [state("a", ReadStatus::Finished, None, Some(1))].into();
    assert!(current_book(&books, &states).is_none());
}

#[test]
fn current_meta_names_series_percent_and_when() {
    let b = book("a", Some(("Earthsea", "2")));
    let (_, s) = state("a", ReadStatus::Reading, Some(42), Some(10 * DAY));
    assert_eq!(
        current_meta(&b, &s, 13 * DAY, Some(0)),
        "Earthsea 2 \u{b7} 42% \u{b7} read 3 days ago"
    );
}

#[test]
fn current_meta_drops_what_it_does_not_know() {
    let b = book("a", None);
    let (_, s) = state("a", ReadStatus::Reading, None, None);
    assert_eq!(current_meta(&b, &s, DAY, Some(0)), "");
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
fn group_by_series_keeps_first_seen_order_and_sets_standalones_apart() {
    let books = vec![
        book("a", Some(("Earthsea", "1"))),
        book("b", Some(("Hainish", "1"))),
        book("c", None),
        book("d", Some(("Earthsea", "2"))),
    ];
    let (shelves, standalone) = group_by_series(books);
    let names: Vec<&str> = shelves.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["Earthsea", "Hainish"]);
    assert_eq!(shelves[0].books.len(), 2);
    assert_eq!(standalone.len(), 1);
    assert_eq!(
        series_count(&[book("a", Some(("X", "1"))), book("b", Some(("X", "2")))]),
        1
    );
}

#[test]
fn shelf_meta_adds_finished_only_when_there_is_some() {
    let books = [book("a", None), book("b", None)];
    let none: BookStates = BookStates::new();
    assert_eq!(shelf_meta(&books, &none), "2 books");
    let one: BookStates = [state("a", ReadStatus::Finished, None, Some(1))].into();
    assert_eq!(shelf_meta(&books, &one), "2 books \u{b7} 1 finished");
}

#[test]
fn hero_meta_leaves_out_a_zero_series_count() {
    assert_eq!(hero_meta(1, 0), "1 book");
    assert_eq!(hero_meta(11, 2), "11 books \u{b7} 2 series");
}
