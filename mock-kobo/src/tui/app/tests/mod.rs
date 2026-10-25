//! `App::on_key` and `App::finish`: which job each key asks for, edit mode, and the busy gate.
//! Split by topic once this crossed the ~800-line cap; shared fixtures live here.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use super::*;

mod busy_and_quit;
mod command_keys;
mod editing;
mod library;
mod reader;

const URL: &str = "http://127.0.0.1:3000";
const QUIT_DEFERRED_MESSAGE: &str =
    "finishing the last action, then quitting; press q again to quit now";

fn key(c: char) -> KeyEvent {
    KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE)
}

fn code(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn with_modifiers(c: char, modifiers: KeyModifiers) -> KeyEvent {
    KeyEvent::new(KeyCode::Char(c), modifiers)
}

fn ctrl_c() -> KeyEvent {
    with_modifiers('c', KeyModifiers::CONTROL)
}

/// Press each character of `text` in turn.
fn type_text(app: &mut App, text: &str) {
    for c in text.chars() {
        app.on_key(key(c), URL);
    }
}

/// An app editing the field `field_key` opens (`u` or `t`), with nothing typed yet.
fn editing(field_key: char) -> App {
    let mut app = App::new(None);
    app.on_key(key(field_key), "");
    app
}

fn editing_buffer(app: &App) -> Option<&str> {
    match &app.mode {
        Mode::Editing(edit) => Some(&edit.buffer),
        Mode::Normal | Mode::Reading(_) => None,
    }
}

fn with_library(uuids: &[&str]) -> App {
    let mut app = App::new(None);
    app.show_library(uuids.iter().map(|s| (*s).to_owned()).collect());
    app
}

fn reader_kepub() -> crate::kepub::Kepub {
    crate::kepub::Kepub::parse(crate::test_support::READER_KEPUB).unwrap()
}

fn book_with_bookmark(bookmark: Option<crate::reading::Bookmark>) -> Book {
    Book {
        authors: vec!["Author".into()],
        reading: crate::reading::Reading {
            status: crate::reading::ReadStatus::Reading,
            status_modified: None,
            bookmark,
        },
        ..crate::test_support::book("book-1", "Reader Fixture").1
    }
}

fn library_with(book: Book) -> BTreeMap<String, Book> {
    BTreeMap::from([("book-1".to_owned(), book)])
}

fn opened_reader_app() -> App {
    let mut app = App::new(None);
    app.open_book("book-1".into(), Ok(Some(reader_kepub())));
    app.fit_reader(24, 3);
    app
}

fn reader_position(app: &App) -> (usize, usize) {
    match &app.mode {
        Mode::Reading(reader) => (reader.chapter, reader.page),
        other => panic!("expected Reading, got {other:?}"),
    }
}
