//! Tests for the series pane's pure helpers: the book offered next and its
//! meta line, a cover's caption, the numbers the library is missing, and
//! who the series is by.

use omnibus_shared::{BookReading, Contributor, EbookMetadata, ReadStatus};

use super::books::{missing_label, missing_numbers, tile_caption};
use super::hero::{books_label, series_authors, SeriesAuthor};
use super::progress::{next_meta, next_up, NextUp};
use super::BookStates;

const DAY: i64 = 86_400;

fn book(uuid: &str, index: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        title: Some(uuid.to_uppercase()),
        unique_identifier: Some(uuid.into()),
        series_index: index.map(Into::into),
        ..Default::default()
    }
}

fn dated(index: Option<&str>, published: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        series_index: index.map(Into::into),
        published: published.map(Into::into),
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

fn three() -> Vec<EbookMetadata> {
    vec![
        book("a", Some("1")),
        book("b", Some("2")),
        book("c", Some("3")),
    ]
}

#[test]
fn next_up_resumes_the_book_in_progress_over_an_earlier_unread_one() {
    let books = three();
    let states: BookStates = [state("b", ReadStatus::Reading, Some(40), Some(5))].into();
    let Some(NextUp::Resume(next, _)) = next_up(&books, &states) else {
        panic!("expected a resume");
    };
    assert_eq!(next.unique_identifier.as_deref(), Some("b"));
}

#[test]
fn next_up_starts_the_first_unread_book_in_reading_order() {
    let books = three();
    let states: BookStates = [
        state("a", ReadStatus::Finished, None, Some(1)),
        state("c", ReadStatus::Finished, None, Some(2)),
    ]
    .into();
    let Some(NextUp::Start { book, fresh }) = next_up(&books, &states) else {
        panic!("expected a start");
    };
    assert_eq!(book.unique_identifier.as_deref(), Some("b"));
    assert!(!fresh, "the reader has finished books here");
}

#[test]
fn next_up_starts_book_one_fresh_and_offers_nothing_once_all_are_finished() {
    let books = three();
    let none = BookStates::new();
    let Some(NextUp::Start { book, fresh }) = next_up(&books, &none) else {
        panic!("expected a start");
    };
    assert_eq!(book.unique_identifier.as_deref(), Some("a"));
    assert!(fresh);
    let done: BookStates = ["a", "b", "c"]
        .map(|u| state(u, ReadStatus::Finished, None, Some(1)))
        .into();
    assert_eq!(next_up(&books, &done), None);
}

#[test]
fn next_meta_names_the_number_percent_and_when_to_resume() {
    let b = book("a", Some("3"));
    let (_, s) = state("a", ReadStatus::Reading, Some(42), Some(10 * DAY));
    assert_eq!(
        next_meta(NextUp::Resume(&b, &s), 13 * DAY, Some(0)),
        "Book 3 \u{b7} 42% \u{b7} read 3 days ago"
    );
}

#[test]
fn next_meta_says_where_to_start() {
    let b = book("a", Some("1"));
    assert_eq!(
        next_meta(
            NextUp::Start {
                book: &b,
                fresh: true
            },
            0,
            None
        ),
        "Start here \u{b7} Book 1"
    );
    let unnumbered = book("x", None);
    assert_eq!(
        next_meta(
            NextUp::Start {
                book: &unnumbered,
                fresh: false
            },
            0,
            None
        ),
        "Up next"
    );
}

#[test]
fn tile_caption_pairs_the_number_with_a_real_year() {
    assert_eq!(
        tile_caption(&dated(Some("1"), Some("2016-05-02"))).as_deref(),
        Some("Book 1 \u{b7} 2016")
    );
}

#[test]
fn tile_caption_reads_the_same_for_an_absent_and_a_sentinel_date() {
    let absent = tile_caption(&dated(Some("1"), None));
    let sentinel = tile_caption(&dated(Some("1"), Some("0101-01-01T00:00:00+00:00")));
    assert_eq!(absent.as_deref(), Some("Book 1"));
    assert_eq!(sentinel, absent);
}

#[test]
fn tile_caption_keeps_a_lone_year_and_drops_an_empty_caption() {
    assert_eq!(
        tile_caption(&dated(None, Some("2016-05"))).as_deref(),
        Some("2016")
    );
    assert_eq!(tile_caption(&dated(None, None)), None);
}

#[test]
fn missing_numbers_lists_the_whole_numbers_below_the_highest_held() {
    let books = [
        book("a", Some("1")),
        book("b", Some("2.5")),
        book("c", Some("4")),
        book("d", Some("7")),
        book("e", None),
    ];
    assert_eq!(missing_numbers(&books), [2, 3, 5, 6]);
}

#[test]
fn missing_numbers_ignores_a_numbering_past_the_scan_limit() {
    let books = [book("a", Some("1")), book("b", Some("2016"))];
    assert!(missing_numbers(&books).is_empty());
}

#[test]
fn missing_label_collapses_runs_and_is_none_without_a_gap() {
    assert_eq!(
        missing_label(&[2, 3, 5, 7, 8, 9]).as_deref(),
        Some("Not in your library: #2\u{2013}3, #5, #7\u{2013}9")
    );
    assert_eq!(missing_label(&[]), None);
}

fn by(names: &[(&str, Option<&str>, Option<i64>)]) -> EbookMetadata {
    EbookMetadata {
        creators: names
            .iter()
            .map(|&(name, role, id)| Contributor {
                name: name.into(),
                role: role.map(Into::into),
                file_as: None,
                id,
            })
            .collect(),
        ..Default::default()
    }
}

#[test]
fn series_authors_takes_each_books_first_author_once_in_order() {
    let books = [
        by(&[("Ann Leckie", Some("aut"), Some(4))]),
        by(&[("Ann Leckie", None, Some(4)), ("Guest", Some("aut"), None)]),
        by(&[
            ("A. Translator", Some("trl"), None),
            ("Bo Ra", Some("aut"), None),
        ]),
    ];
    assert_eq!(
        series_authors(&books),
        [
            SeriesAuthor {
                name: "Ann Leckie".into(),
                id: Some(4)
            },
            SeriesAuthor {
                name: "Bo Ra".into(),
                id: None
            },
        ]
    );
}

#[test]
fn books_label_counts_one_book_in_the_singular() {
    assert_eq!(books_label(1), "1 book");
    assert_eq!(books_label(7), "7 books");
}
