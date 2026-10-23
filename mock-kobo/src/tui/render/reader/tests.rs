//! `reader::draw` through ratatui's `TestBackend`: the page view and the metadata-only view.

use std::collections::BTreeMap;

use ratatui::backend::TestBackend;
use ratatui::Terminal;

use crate::control::DeviceView;
use crate::device::Book;
use crate::kepub::Kepub;
use crate::test_support::READER_KEPUB;
use crate::tui::app::{App, Mode};
use crate::tui::reader::Reader;
use crate::tui::render::{draw, Screen};
use crate::wire::Series;

fn book(title: &str) -> Book {
    Book {
        title: title.to_owned(),
        description: String::new(),
        authors: vec!["Frank Herbert".to_owned()],
        series: None,
        downloaded: true,
        archived: false,
        cover_image_id: String::new(),
        cover: None,
        download_problem: None,
        reading: crate::reading::Reading::default(),
        annotations: Vec::new(),
        dropped_annotations: 0,
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

fn shown(view: &DeviceView, reader: Reader) -> String {
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).unwrap();
    let app = App {
        mode: Mode::Reading(Box::new(reader)),
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
    terminal.backend().to_string()
}

#[test]
fn draw_shows_the_reader_page_with_its_chapter_page_and_percent() {
    let kepub = Kepub::parse(READER_KEPUB).unwrap();
    let mut reader = Reader::open("book-1".to_owned(), Some(kepub));
    reader.fit(24, 3);

    let shown = shown(&library(book("Reader Fixture")), reader);

    assert!(shown.contains("Reader Fixture"), "{shown}");
    assert!(shown.contains("ch 1/3"), "{shown}");
    assert!(shown.contains("p 1/5"), "{shown}");
    assert!(shown.contains("0%"), "{shown}");
    assert!(shown.contains("Chapter"), "{shown}");
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
