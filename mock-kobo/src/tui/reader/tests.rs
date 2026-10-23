//! `paginate` against the reader fixture, then every `Reader::on_key`.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::annotations::Swatch;
use crate::kepub::Kepub;
use crate::test_support::READER_KEPUB;
use crate::tui::app::Job;

use super::*;

fn fixture() -> Kepub {
    Kepub::parse(READER_KEPUB).unwrap()
}

fn opened() -> Reader {
    let mut reader = Reader::open("book-1".into(), Some(fixture()));
    reader.fit(24, 3);
    reader
}

fn press(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn all_lines(pages: &[Page]) -> Vec<std::ops::RangeInclusive<usize>> {
    pages.iter().flat_map(|p| p.lines.clone()).collect()
}

#[test]
fn paginate_starts_each_paragraph_on_a_new_line() {
    let kepub = fixture();
    let lines = all_lines(&paginate(&kepub, 0, 24, 3));

    assert_eq!(
        lines[0],
        0..=1,
        "\"Chapter One\" (kobo.1) opens its own line"
    );
    assert_eq!(
        lines[1],
        2..=5,
        "\"The desert...\" (kobo.2) opens its own line"
    );
    assert_eq!(
        lines[3],
        8..=11,
        "\"Paul...\" (kobo.3) opens its own line even though the prior one had room"
    );
    assert_eq!(
        lines[9],
        33..=34,
        "\"utterly\"/\" silent.\" (kobo.5.2/.3) share kobo.5's paragraph, so wrapping \
         (not a paragraph break) ends that line"
    );
}

#[test]
fn paginate_wraps_to_the_width_and_splits_pages_by_rows() {
    let kepub = fixture();

    let pages = paginate(&kepub, 0, 24, 3);

    let first_words: Vec<usize> = pages.iter().map(|p| *p.lines[0].start()).collect();
    assert_eq!(first_words, [0, 8, 19, 33, 42]);
}

#[test]
fn paginate_names_the_span_of_each_pages_first_word() {
    let kepub = fixture();

    let pages = paginate(&kepub, 0, 24, 3);

    let spans: Vec<usize> = pages.iter().map(|p| p.span).collect();
    assert_eq!(spans, [0, 2, 3, 5, 8]);
    // Page 2 opens mid-span: its first word ("traded", index 19) sits inside
    // kobo.4.1 (span 3), not that span's own first word (index 15, "Water").
    assert_eq!(pages[2].span, 3);
}

#[test]
fn paginate_records_the_book_percent_of_each_pages_span() {
    let kepub = fixture();

    let pages = paginate(&kepub, 0, 24, 3);

    let percents: Vec<u8> = pages.iter().map(|p| u8::from(p.percent)).collect();
    // Page 2 opens mid-span (word 19, inside kobo.4.1), so its percent
    // counts only the words of *earlier* spans (0..=2, 15 words) — not the
    // words of kobo.4.1 before word 19 — matching `Kepub::bookmark`.
    assert_eq!(percents, [0, 10, 18, 41, 52]);
}

#[test]
fn on_key_turns_pages_and_crosses_into_the_next_chapter_at_its_end() {
    let mut reader = opened();
    reader.cursor = 42; // ch1's last page (page 4)
    reader.fit(24, 3);

    reader.on_key(press(KeyCode::Right));

    assert_eq!((reader.chapter, reader.page, reader.cursor), (1, 0, 0));
}

#[test]
fn on_key_turns_back_into_the_previous_chapters_last_page() {
    let mut reader = opened();
    reader.chapter = 1;
    reader.fit(24, 3);

    reader.on_key(press(KeyCode::Left));

    assert_eq!((reader.chapter, reader.page, reader.cursor), (0, 4, 42));
}

#[test]
fn on_key_jumps_chapters_with_brackets() {
    let mut reader = opened();

    reader.on_key(press(KeyCode::Char(']')));
    assert_eq!((reader.chapter, reader.page, reader.cursor), (1, 0, 0));

    reader.on_key(press(KeyCode::Char('[')));
    assert_eq!((reader.chapter, reader.page, reader.cursor), (0, 0, 0));

    reader.on_key(press(KeyCode::Char('[')));
    assert_eq!(
        (reader.chapter, reader.page, reader.cursor),
        (0, 0, 0),
        "a no-op at the book's first chapter"
    );
}

#[test]
fn on_key_does_nothing_past_the_books_first_and_last_page() {
    let mut reader = opened();
    reader.on_key(press(KeyCode::Left));
    assert_eq!((reader.chapter, reader.page, reader.cursor), (0, 0, 0));

    let mut reader = opened();
    reader.chapter = 2;
    reader.fit(24, 3);
    reader.on_key(press(KeyCode::Right));
    assert_eq!((reader.chapter, reader.page, reader.cursor), (2, 0, 0));
}

#[test]
fn on_key_moves_the_cursor_word_by_word_within_the_page() {
    let mut reader = opened();

    reader.on_key(press(KeyCode::Down));
    assert_eq!(reader.cursor, 1);

    reader.on_key(press(KeyCode::Up));
    reader.on_key(press(KeyCode::Up));
    assert_eq!(reader.cursor, 0, "clamped at the page's first word");

    for _ in 0..10 {
        reader.on_key(press(KeyCode::Down));
    }
    assert_eq!(reader.cursor, 7, "clamped at the page's last word");
}

#[test]
fn fit_keeps_the_first_word_on_screen_when_the_size_changes() {
    let mut reader = opened();
    reader.cursor = 19; // page 2's first word at 24x3
    reader.fit(24, 3);
    assert_eq!(reader.page, 2);

    reader.fit(40, 5);

    let pages = reader.pages();
    let page = &pages[reader.page];
    assert!(
        *page.lines[0].start() <= 19 && 19 <= *page.lines.last().unwrap().end(),
        "the word that was on screen is still on screen"
    );
}

#[test]
fn on_key_closes_with_a_read_job_naming_the_pages_span_and_percent() {
    let mut reader = opened();
    reader.on_key(press(KeyCode::Right));
    reader.on_key(press(KeyCode::Right));

    let action = reader.on_key(press(KeyCode::Esc));

    let Some(ReaderAction::Close(Some(Job::Read {
        book,
        percent,
        location,
    }))) = action
    else {
        panic!("expected a Read job, got {action:?}");
    };
    assert_eq!(book, "book-1");
    assert_eq!(u8::from(percent), 18);
    let location = location.unwrap();
    assert_eq!(location.source, "ch1.xhtml");
    assert_eq!(location.value, "kobo.4.1");
}

#[test]
fn on_key_closes_a_metadata_only_book_without_a_job() {
    let mut reader = Reader::open("book-1".into(), None);

    let action = reader.on_key(press(KeyCode::Esc));

    assert_eq!(action, Some(ReaderAction::Close(None)));
}

fn opened_on_ch2() -> Reader {
    let mut reader = opened();
    reader.chapter = 1;
    reader.cursor = 2; // "The", the first word of kobo.2.1
    reader.fit(24, 3);
    reader
}

#[test]
fn on_key_extends_the_selection_word_by_word_with_the_arrows() {
    let mut reader = opened_on_ch2();

    reader.on_key(press(KeyCode::Char('v')));
    reader.on_key(press(KeyCode::Right));
    reader.on_key(press(KeyCode::Right));

    assert_eq!(
        reader.selection,
        Some(Selection {
            start: 2,
            end: 4,
            note: None
        })
    );
}

#[test]
fn on_key_keeps_the_selection_end_on_the_page_and_never_before_its_start() {
    let mut reader = opened_on_ch2();
    reader.on_key(press(KeyCode::Char('v')));

    for _ in 0..3 {
        reader.on_key(press(KeyCode::Left));
    }
    assert_eq!(
        reader.selection.as_ref().unwrap().end,
        2,
        "never before start"
    );

    for _ in 0..30 {
        reader.on_key(press(KeyCode::Right));
    }
    assert_eq!(
        reader.selection.as_ref().unwrap().end,
        10,
        "clamped to the page's last word"
    );
}

#[test]
fn on_key_returns_a_highlight_job_in_the_swatch_its_digit_names() {
    let mut reader = opened_on_ch2();
    reader.on_key(press(KeyCode::Char('v')));
    reader.on_key(press(KeyCode::Right));
    reader.on_key(press(KeyCode::Right));

    let action = reader.on_key(press(KeyCode::Char('3')));

    let Some(ReaderAction::Run(Job::Highlight { book, highlight })) = action else {
        panic!("expected a Highlight job, got {action:?}");
    };
    assert_eq!(book, "book-1");
    assert_eq!(highlight.color, Swatch::Blue);
    assert_eq!(highlight.text, "The café at");
    let location = highlight.location.unwrap();
    assert_eq!(location.start_span, "kobo.2.1");
    assert_eq!(location.start_char, 0);
    assert_eq!(location.end_span, "kobo.2.1");
    assert_eq!(location.end_char, 11);
    assert_eq!(reader.selection, None, "the selection is cleared");
}

#[test]
fn on_key_attaches_a_typed_note_to_the_highlight() {
    let mut reader = opened_on_ch2();
    reader.on_key(press(KeyCode::Char('v')));
    reader.on_key(press(KeyCode::Char('n')));
    for c in "a thought".chars() {
        reader.on_key(press(KeyCode::Char(c)));
    }
    reader.on_key(press(KeyCode::Enter));

    let action = reader.on_key(press(KeyCode::Char('2')));

    let Some(ReaderAction::Run(Job::Highlight { highlight, .. })) = action else {
        panic!("expected a Highlight job, got {action:?}");
    };
    assert_eq!(highlight.color, Swatch::Pink);
    assert_eq!(highlight.note, Some("a thought".to_owned()));
}

#[test]
fn on_key_treats_an_empty_typed_note_as_none() {
    let mut reader = opened_on_ch2();
    reader.on_key(press(KeyCode::Char('v')));
    reader.on_key(press(KeyCode::Char('n')));

    reader.on_key(press(KeyCode::Enter));

    let action = reader.on_key(press(KeyCode::Char('1')));
    let Some(ReaderAction::Run(Job::Highlight { highlight, .. })) = action else {
        panic!("expected a Highlight job, got {action:?}");
    };
    assert_eq!(highlight.color, Swatch::Yellow);
    assert_eq!(highlight.note, None);
}

#[test]
fn on_key_cancels_the_selection_on_esc_without_closing_the_book() {
    let mut reader = opened_on_ch2();
    reader.on_key(press(KeyCode::Char('v')));

    let action = reader.on_key(press(KeyCode::Esc));

    assert_eq!(action, None);
    assert_eq!(reader.selection, None);
    assert_eq!(reader.chapter, 1, "the book stays open");
}

#[test]
fn on_key_deletes_the_listed_highlight_with_x() {
    let mut reader = opened();
    reader.annotations = vec![crate::test_support::annotation("h-1")];
    reader.on_key(press(KeyCode::Char('h')));

    let action = reader.on_key(press(KeyCode::Char('x')));

    assert_eq!(
        action,
        Some(ReaderAction::Run(Job::DeleteHighlight {
            book: "book-1".to_owned(),
            highlight: "h-1".to_owned(),
        }))
    );
    assert_eq!(reader.view, ReaderView::Page);
}

#[test]
fn on_key_returns_to_the_page_from_the_list_on_esc() {
    let mut reader = opened();
    reader.on_key(press(KeyCode::Char('h')));

    let action = reader.on_key(press(KeyCode::Esc));

    assert_eq!(action, None);
    assert_eq!(reader.view, ReaderView::Page);
}
