//! `reader::draw` through ratatui's `TestBackend`: the page view, the
//! selection, the note prompt, and the metadata-only view.

use std::collections::BTreeMap;

use ratatui::backend::TestBackend;
use ratatui::style::{Color, Modifier};
use ratatui::Terminal;

use crate::annotations::{location_json, Annotation, SpanRange, Swatch};
use crate::control::DeviceView;
use crate::device::Book;
use crate::kepub::Kepub;
use crate::test_support::READER_KEPUB;
use crate::tui::app::{App, Mode, Status};
use crate::tui::reader::{Reader, ReaderView, Selection};
use crate::tui::render::{draw, Screen};
use crate::wire::Series;

fn book(title: &str) -> Book {
    Book {
        authors: vec!["Frank Herbert".to_owned()],
        ..crate::test_support::book("book-1", title).1
    }
}

fn library(book: Book) -> DeviceView {
    DeviceView {
        hardware_id: "mock-ab12".to_owned(),
        url: "http://127.0.0.1:3000".to_owned(),
        syncing: false,
        last_sync: None,
        sync_token: None,
        library: BTreeMap::from([("book-1".to_owned(), book)]),
    }
}

fn drawn(view: &DeviceView, reader: Reader, status: Option<Status>) -> Terminal<TestBackend> {
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).unwrap();
    let app = App {
        mode: Mode::Reading(Box::new(reader)),
        status,
        ..App::default()
    };
    let screen = Screen {
        view,
        requests: &[],
        port: 47431,
        state: std::path::Path::new(".claude/runtime/mock-kobo.json"),
        app: &app,
    };
    terminal.draw(|frame| draw(frame, &screen)).unwrap();
    terminal
}

fn shown(view: &DeviceView, reader: Reader) -> String {
    drawn(view, reader, None).backend().to_string()
}

fn screen_rows(terminal: &Terminal<TestBackend>) -> Vec<String> {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect()
        })
        .collect()
}

#[test]
fn draw_shows_the_reader_page_with_its_chapter_page_and_percent() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.fit(24, 3);

    let shown = shown(&library(book("Reader Fixture")), reader);

    assert!(shown.contains("Reader Fixture"), "{shown}");
    assert!(shown.contains("ch 1/3"), "{shown}");
    assert!(shown.contains("p 1/5 · 0%"), "{shown}");
    assert!(shown.contains("Chapter"), "{shown}");
}

#[test]
fn draw_shows_the_apps_status_while_the_reader_is_open() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.fit(24, 3);

    let shown = drawn(
        &library(book("Reader Fixture")),
        reader,
        Some(Status::Error("boom".to_owned())),
    )
    .backend()
    .to_string();

    assert!(shown.contains("boom"), "{shown}");
}

#[test]
fn draw_shows_metadata_and_waiting_highlights_for_an_undownloaded_book() {
    let mut not_downloaded = book("Reader Fixture");
    not_downloaded.downloaded = false;
    not_downloaded.description = "A desert planet.".to_owned();
    not_downloaded.series = Some(Series {
        name: "Dune".to_owned(),
        number: Some(1.0),
        id: "s-1".to_owned(),
    });
    not_downloaded.dropped_annotations = 3;
    let reader = Reader::open("book-1".to_owned(), None);

    let shown = shown(&library(not_downloaded), reader);

    assert!(shown.contains("Reader Fixture"), "{shown}");
    assert!(shown.contains("Frank Herbert"), "{shown}");
    assert!(shown.contains("Dune #1"), "{shown}");
    assert!(shown.contains("A desert planet."), "{shown}");
    assert!(shown.contains("not downloaded"), "{shown}");
    assert!(
        shown.contains("3 highlights wait for the download"),
        "{shown}"
    );
}

/// The (x, y) of `word`'s first character on screen, in the smallest row that holds it.
fn locate(terminal: &Terminal<TestBackend>, word: &str) -> (u16, u16) {
    screen_rows(terminal)
        .iter()
        .zip(0..)
        .find_map(|(row, y)| row.find(word).map(|x| (x as u16, y)))
        .unwrap_or_else(|| panic!("{word:?} not on screen"))
}

#[test]
fn draw_shows_the_selection_reversed_on_the_page() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.chapter = 1;
    reader.cursor = 2; // "The", kobo.2.1's first word
    reader.fit(24, 3);
    reader.selection = Some(Selection {
        start: 2,
        end: 3, // "The café"
        note: None,
    });

    let terminal = drawn(&library(book("Reader Fixture")), reader, None);

    let (x, y) = locate(&terminal, "café");
    assert!(
        terminal.backend().buffer()[(x, y)]
            .modifier
            .contains(Modifier::REVERSED),
        "the selected word is reversed"
    );
    let (x, y) = locate(&terminal, "at");
    assert!(
        !terminal.backend().buffer()[(x, y)]
            .modifier
            .contains(Modifier::REVERSED),
        "a word outside the selection is not"
    );
}

#[test]
fn draw_shows_the_note_prompt_while_typing_a_note() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.fit(24, 3);
    reader.selection = Some(Selection {
        start: 0,
        end: 1,
        note: None,
    });
    reader.view = ReaderView::Note("a thought".to_owned());

    let shown = shown(&library(book("Reader Fixture")), reader);

    assert!(shown.contains("note: a thought"), "{shown}");
}

fn naive_to_zurich_range() -> SpanRange {
    SpanRange {
        chapter: "ch2.xhtml".to_owned(),
        start_span: "kobo.2.1".to_owned(),
        start_char: 22,
        end_span: "kobo.2.1".to_owned(),
        end_char: 55,
    }
}

#[test]
fn draw_colours_a_highlighted_word_in_its_swatch() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.chapter = 1;
    reader.cursor = 2;
    reader.fit(24, 3);
    reader.annotations = vec![Annotation {
        id: "h-1".to_owned(),
        text: "naïve and still, far from Zürich.".to_owned(),
        note: None,
        color: Swatch::Blue,
        location: location_json(Some(&naive_to_zurich_range())),
    }];

    let terminal = drawn(&library(book("Reader Fixture")), reader, None);

    let (x, y) = locate(&terminal, "café");
    assert_ne!(
        terminal.backend().buffer()[(x, y)].bg,
        Color::Cyan,
        "a word outside the highlight is not coloured"
    );
    let (x, y) = locate(&terminal, "naïve");
    let cell = &terminal.backend().buffer()[(x, y)];
    assert_eq!(cell.bg, Color::Cyan);
    assert_eq!(cell.fg, Color::Black);
}

#[test]
fn draw_lists_each_highlight_with_its_colour_text_and_note() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.fit(24, 3);
    reader.annotations = vec![Annotation {
        id: "h-1".to_owned(),
        text: "a passage".to_owned(),
        note: Some("a thought".to_owned()),
        color: Swatch::Pink,
        location: location_json(Some(&naive_to_zurich_range())),
    }];
    reader.view = ReaderView::Highlights(0);

    let shown = shown(&library(book("Reader Fixture")), reader);

    assert!(shown.contains("[Pink]"), "{shown}");
    assert!(shown.contains("a passage"), "{shown}");
    assert!(shown.contains("a thought"), "{shown}");
}

#[test]
fn draw_marks_a_highlight_the_book_cannot_place() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.fit(24, 3);
    reader.annotations = vec![Annotation {
        id: "h-1".to_owned(),
        text: "a passage".to_owned(),
        note: None,
        color: Swatch::Green,
        location: location_json(None),
    }];
    reader.view = ReaderView::Highlights(0);

    let shown = shown(&library(book("Reader Fixture")), reader);

    assert!(shown.contains("(not placed)"), "{shown}");
}
