//! Tests for the series pane: the book offered next, its meta line and its
//! button; a cover's caption; the numbers the library is missing and the
//! heading that names them; the empty and error notes; and who the series
//! is by.

use omnibus_shared::{BookReading, Contributor, EbookMetadata, ProgressFormat, ReadStatus};

use crate::pages::browse::test_support::{book, state, DAY};
use crate::Route;

use super::books::{missing_label, missing_numbers, tile_caption};
use super::hero::{series_authors, SeriesAuthor};
use super::progress::{next_action, next_meta, next_up, NextAction, NextUp};
use super::{is_whole, way_back, BookStates};

fn dated(index: Option<&str>, published: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        series_index: index.map(Into::into),
        published: published.map(Into::into),
        ..Default::default()
    }
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
    let Some(NextUp::Start { book, fresh, .. }) = next_up(&books, &states) else {
        panic!("expected a start");
    };
    assert_eq!(book.unique_identifier.as_deref(), Some("b"));
    assert!(!fresh, "the reader has finished books here");
}

#[test]
fn next_up_starts_book_one_fresh_and_offers_nothing_once_all_are_finished() {
    let books = three();
    let none = BookStates::new();
    let Some(NextUp::Start { book, fresh, .. }) = next_up(&books, &none) else {
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
                state: None,
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
                state: None,
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

/// Book "a", readable as an EPUB or an audiobook.
fn dual(index: &str) -> EbookMetadata {
    EbookMetadata {
        formats: vec!["epub".into(), "m4b".into()],
        ..book("a", Some(index))
    }
}

#[test]
fn next_action_starts_a_fresh_book_at_its_beginning() {
    let b = dual("1");
    let action = next_action(NextUp::Start {
        book: &b,
        state: None,
        fresh: true,
    });
    assert_eq!(
        action,
        NextAction {
            label: "Start",
            to: Route::BookRead { uuid: "a".into() },
            testid: "series-next",
            action_testid: "series-start",
        }
    );
}

#[test]
fn next_action_resumes_an_unread_book_where_its_kept_position_is() {
    // Marking a book unread keeps its position, and the player opens there.
    let b = dual("4");
    let kept = BookReading {
        book_uuid: "a".into(),
        status: ReadStatus::Unread,
        percent: Some(42),
        format: Some(ProgressFormat::Audio),
        book_file_id: Some(9),
        last_read_at: None,
    };
    let next = NextUp::Start {
        book: &b,
        state: Some(&kept),
        fresh: false,
    };
    let action = next_action(next);
    assert_eq!(
        (action.label, action.action_testid),
        ("Resume", "series-resume")
    );
    assert_eq!(
        action.to,
        Route::BookListen {
            uuid: "a".into(),
            file_id: Some(9)
        }
    );
    assert_eq!(next_meta(next, 0, None), "Up next \u{b7} Book 4 \u{b7} 42%");
}

#[test]
fn next_action_resumes_the_book_in_progress_in_its_format() {
    let b = dual("2");
    let (_, s) = state("a", ReadStatus::Reading, Some(10), Some(1));
    let listening = BookReading {
        format: Some(ProgressFormat::Audio),
        book_file_id: Some(3),
        ..s
    };
    let action = next_action(NextUp::Resume(&b, &listening));
    let player = Route::BookListen {
        uuid: "a".into(),
        file_id: Some(3),
    };
    assert_eq!(
        (action.label, action.testid, action.to),
        ("Resume", "series-current", player)
    );
}

#[test]
fn next_action_resumes_a_book_marked_reading_that_has_no_position_yet() {
    let b = dual("2");
    let (_, marked) = state("a", ReadStatus::Reading, None, Some(1));
    let action = next_action(NextUp::Resume(&b, &marked));
    assert_eq!(
        (action.label, action.action_testid),
        ("Resume", "series-resume")
    );
}

#[test]
fn next_meta_says_up_next_rather_than_start_here_for_a_kept_position() {
    let b = book("a", Some("1"));
    let (_, mut kept) = state("a", ReadStatus::Unread, Some(30), None);
    kept.format = Some(ProgressFormat::Epub);
    let next = NextUp::Start {
        book: &b,
        state: Some(&kept),
        fresh: true,
    };
    assert_eq!(next_meta(next, 0, None), "Up next \u{b7} Book 1 \u{b7} 30%");
}

#[test]
fn is_whole_holds_only_when_every_book_of_the_series_loaded() {
    assert!(is_whole(5, 5));
    assert!(!is_whole(1_000, 1_204), "a capped list is a part");
}

#[test]
fn next_up_keeps_the_position_of_a_book_marked_unread() {
    let books = three();
    let (_, mut kept) = state("a", ReadStatus::Unread, Some(30), None);
    kept.format = Some(ProgressFormat::Epub);
    let states: BookStates = [("a".to_string(), kept)].into();
    let Some(NextUp::Start { state, .. }) = next_up(&books, &states) else {
        panic!("expected a start");
    };
    assert_eq!(state.and_then(|s| s.percent), Some(30));
}

#[test]
fn way_back_leads_to_the_list_except_from_the_list_itself() {
    assert_eq!(
        way_back(false),
        (Route::SeriesIndex {}, "Back to series".to_string())
    );
    assert_eq!(
        way_back(true),
        (Route::Landing {}, "Back to library".to_string())
    );
}

/// The pane's parts that draw no router link, rendered (SSR needs `server`).
#[cfg(feature = "server")]
mod render {
    use crate::test_support::render;

    use super::super::books::{reading_order_head, series_books};
    use super::*;

    #[test]
    fn reading_order_head_names_the_gaps_and_counts_a_capped_list_as_a_part() {
        let books = [book("a", Some("1")), book("c", Some("3"))];
        let whole = render(reading_order_head(&books, &BookStates::new(), 2));
        assert!(whole.contains("2 books"), "{whole}");
        assert!(whole.contains(r#"data-testid="series-gaps""#), "{whole}");
        assert!(whole.contains("Not in your library: #2"), "{whole}");
        let capped = render(reading_order_head(&books, &BookStates::new(), 1_204));
        assert!(capped.contains("First 2 of 1204 books"), "{capped}");
    }

    #[test]
    fn series_books_says_so_when_the_library_holds_none_of_the_series() {
        let html = render(series_books(Vec::new(), &BookStates::new(), "", 0));
        assert!(html.contains(r#"data-testid="series-empty""#), "{html}");
        assert!(html.contains("No books in this series"), "{html}");
    }
}
