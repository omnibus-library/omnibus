//! `App::on_key` and `App::finish`: which job each key asks for, edit mode, and the busy gate.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use super::*;

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

#[test]
fn on_key_returns_sync_job_when_s_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('s'), URL), Some(Action::Run(Job::Sync)));
}

#[test]
fn on_key_returns_reset_job_when_r_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('r'), URL), Some(Action::Run(Job::Reset)));
}

#[test]
fn on_key_returns_wire_job_when_w_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('w'), URL), Some(Action::Run(Job::Wire)));
}

#[test]
fn on_key_returns_quit_when_q_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('q'), URL), Some(Action::Quit));
}

#[test]
fn on_key_returns_quit_when_ctrl_c_pressed_in_any_mode() {
    let ctrl_c = with_modifiers('c', KeyModifiers::CONTROL);
    let mut normal = App::new(None);
    let mut editing_url = editing('u');

    assert_eq!(normal.on_key(ctrl_c, URL), Some(Action::Quit));
    assert_eq!(editing_url.on_key(ctrl_c, URL), Some(Action::Quit));
}

#[test]
fn on_key_accepts_uppercase_command_keys() {
    let cases = [
        ('S', Action::Run(Job::Sync)),
        ('R', Action::Run(Job::Reset)),
        ('W', Action::Run(Job::Wire)),
        ('Q', Action::Quit),
    ];
    for (c, expected) in cases {
        let mut app = App::new(None);

        let action = app.on_key(with_modifiers(c, KeyModifiers::SHIFT), URL);

        assert_eq!(action, Some(expected), "key {c}");
    }
}

#[test]
fn on_key_opens_edits_when_uppercase_u_or_t_pressed() {
    for (c, field) in [('U', Field::Url), ('T', Field::Token)] {
        let mut app = App::new(None);

        assert_eq!(app.on_key(key(c), URL), None);

        let Mode::Editing(edit) = &app.mode else {
            panic!("key {c} should open an edit");
        };
        assert_eq!(edit.field, field);
    }
}

#[test]
fn on_key_ignores_unmapped_key() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('z'), URL), None);
    assert_eq!(app.mode, Mode::Normal);
    assert_eq!(app.status, None);
    assert!(!app.busy);
}

#[test]
fn on_key_ignores_command_letter_pressed_with_ctrl_or_alt() {
    let mut app = App::new(None);

    assert_eq!(
        app.on_key(with_modifiers('s', KeyModifiers::CONTROL), URL),
        None
    );
    assert_eq!(
        app.on_key(with_modifiers('q', KeyModifiers::ALT), URL),
        None
    );
    assert!(!app.busy);
}

#[test]
fn on_key_opens_url_edit_prefilled_with_current_url_when_u_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('u'), URL), None);

    let expected = Edit {
        field: Field::Url,
        buffer: URL.to_owned(),
    };
    assert_eq!(app.mode, Mode::Editing(expected));
}

#[test]
fn on_key_opens_empty_token_edit_when_t_pressed() {
    let mut app = App::new(None);

    assert_eq!(app.on_key(key('t'), URL), None);

    let expected = Edit {
        field: Field::Token,
        buffer: String::new(),
    };
    assert_eq!(app.mode, Mode::Editing(expected));
}

#[test]
fn on_key_types_command_letters_into_edit_buffer() {
    let mut app = editing('t');

    type_text(&mut app, "qsrwutx");

    assert_eq!(editing_buffer(&app), Some("qsrwutx"));
    assert!(!app.busy);
}

#[test]
fn on_key_types_shifted_char_into_edit_buffer() {
    let mut app = editing('t');

    app.on_key(with_modifiers('A', KeyModifiers::SHIFT), URL);

    assert_eq!(editing_buffer(&app), Some("A"));
}

#[test]
fn on_key_does_not_type_ctrl_or_alt_chars_into_edit_buffer() {
    let mut app = editing('t');

    app.on_key(with_modifiers('x', KeyModifiers::CONTROL), URL);
    app.on_key(with_modifiers('y', KeyModifiers::ALT), URL);

    assert_eq!(editing_buffer(&app), Some(""));
}

#[test]
fn on_key_deletes_last_char_on_backspace() {
    let mut app = editing('t');
    type_text(&mut app, "abc");

    app.on_key(code(KeyCode::Backspace), URL);

    assert_eq!(editing_buffer(&app), Some("ab"));
}

#[test]
fn on_key_ignores_backspace_on_empty_buffer() {
    let mut app = editing('t');

    assert_eq!(app.on_key(code(KeyCode::Backspace), URL), None);

    assert_eq!(editing_buffer(&app), Some(""));
}

#[test]
fn on_key_cancels_edit_on_esc() {
    let mut app = App::new(Some("note".to_owned()));
    app.on_key(key('t'), URL);
    type_text(&mut app, "abc");

    assert_eq!(app.on_key(code(KeyCode::Esc), URL), None);

    assert_eq!(app.mode, Mode::Normal);
    assert_eq!(app.status, Some(Status::Info("note".to_owned())));
    assert!(!app.busy);
}

#[test]
fn on_key_returns_set_url_job_with_origin_on_enter() {
    let mut app = editing('u');
    type_text(&mut app, "http://127.0.0.1:3001/");

    let action = app.on_key(code(KeyCode::Enter), URL);

    let expected = Job::SetUrl("http://127.0.0.1:3001".to_owned());
    assert_eq!(action, Some(Action::Run(expected)));
    assert_eq!(app.mode, Mode::Normal);
}

#[test]
fn on_key_cancels_url_edit_when_url_unchanged() {
    let mut app = App::new(Some("note".to_owned()));
    app.on_key(key('u'), URL);

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert_eq!(app.mode, Mode::Normal);
    assert_eq!(app.status, Some(Status::Info("note".to_owned())));
    assert!(!app.busy);
}

#[test]
fn on_key_keeps_url_edit_open_with_error_when_url_invalid() {
    let mut app = editing('u');
    type_text(&mut app, "ftp://nope");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert_eq!(editing_buffer(&app), Some("ftp://nope"));
    let message = "invalid server URL: expected an http:// or https:// URL";
    assert_eq!(app.status, Some(Status::Error(message.to_owned())));
    assert!(!app.busy);
}

#[test]
fn on_key_returns_set_token_job_on_enter() {
    let mut app = editing('t');
    type_text(&mut app, "new-token_1");

    let action = app.on_key(code(KeyCode::Enter), URL);

    let expected = Job::SetToken("new-token_1".to_owned());
    assert_eq!(action, Some(Action::Run(expected)));
    assert_eq!(app.mode, Mode::Normal);
}

#[test]
fn on_key_keeps_token_edit_open_with_error_when_token_invalid() {
    let message = "invalid device token: expected letters, digits, '-' and '_' only";
    let mut empty = editing('t');
    let mut spaced = editing('t');
    type_text(&mut spaced, "has space");

    assert_eq!(empty.on_key(code(KeyCode::Enter), URL), None);
    assert_eq!(spaced.on_key(code(KeyCode::Enter), URL), None);

    assert_eq!(editing_buffer(&empty), Some(""));
    assert_eq!(editing_buffer(&spaced), Some("has space"));
    assert_eq!(empty.status, Some(Status::Error(message.to_owned())));
    assert_eq!(spaced.status, Some(Status::Error(message.to_owned())));
}

#[test]
fn on_key_clears_status_when_job_starts() {
    let mut app = App::new(Some("note".to_owned()));

    app.on_key(key('s'), URL);

    assert_eq!(app.status, None);
}

#[test]
fn on_key_refuses_job_while_busy() {
    for job_key in ['s', 'r', 'w'] {
        let mut app = App::new(None);
        app.on_key(key('s'), URL);

        assert_eq!(app.on_key(key(job_key), URL), None, "key {job_key}");

        assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
        assert!(app.busy);
    }
}

#[test]
fn on_key_keeps_edit_open_when_enter_pressed_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);
    app.on_key(key('t'), URL);
    type_text(&mut app, "new-token");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert_eq!(editing_buffer(&app), Some("new-token"));
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn on_key_shows_validation_error_when_invalid_entry_saved_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);
    app.on_key(key('t'), URL);
    type_text(&mut app, "has space");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert_eq!(editing_buffer(&app), Some("has space"));
    let message = "invalid device token: expected letters, digits, '-' and '_' only";
    assert_eq!(app.status, Some(Status::Error(message.to_owned())));
}

#[test]
fn on_key_defers_quit_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    assert_eq!(app.on_key(key('q'), URL), None);

    assert_eq!(
        app.status,
        Some(Status::Info(QUIT_DEFERRED_MESSAGE.to_owned()))
    );
    assert!(app.busy);
    assert!(!app.quit_requested());
}

#[test]
fn on_key_defers_ctrl_c_while_busy() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    assert_eq!(app.on_key(ctrl_c(), URL), None);

    assert_eq!(
        app.status,
        Some(Status::Info(QUIT_DEFERRED_MESSAGE.to_owned()))
    );
    assert!(app.busy);
    assert!(!app.quit_requested());
}

#[test]
fn on_key_quits_on_second_press_while_busy() {
    for first in [key('q'), ctrl_c()] {
        for second in [key('q'), ctrl_c()] {
            let mut app = App::new(None);
            app.on_key(key('s'), URL);
            app.on_key(first, URL);

            assert_eq!(app.on_key(second, URL), Some(Action::Quit));
        }
    }
}

#[test]
fn finish_requests_deferred_quit() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);
    app.on_key(key('q'), URL);

    app.finish(Status::Info("sync complete".to_owned()));

    assert!(app.quit_requested());
}

#[test]
fn finish_requests_no_quit_without_deferred_quit() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    app.finish(Status::Info("sync complete".to_owned()));

    assert!(!app.quit_requested());
}

#[test]
fn finish_clears_busy_and_shows_status() {
    let mut app = App::new(None);
    app.on_key(key('s'), URL);

    app.finish(Status::Info("sync complete".to_owned()));

    assert!(!app.busy);
    assert_eq!(app.status, Some(Status::Info("sync complete".to_owned())));
    assert_eq!(app.on_key(key('r'), URL), Some(Action::Run(Job::Reset)));
}

#[test]
fn on_key_ignores_key_release() {
    for kind in [KeyEventKind::Release, KeyEventKind::Repeat] {
        let mut app = App::new(None);
        let event = KeyEvent { kind, ..key('s') };

        assert_eq!(app.on_key(event, URL), None, "kind {kind:?}");

        assert!(!app.busy);
    }
}

#[test]
fn new_shows_startup_notice_as_info_status() {
    let app = App::new(Some("wired to the existing device".to_owned()));

    let expected = Status::Info("wired to the existing device".to_owned());
    assert_eq!(app.status, Some(expected));
}

#[test]
fn new_has_no_status_without_a_notice() {
    let app = App::new(None);

    assert_eq!(app.status, None);
    assert_eq!(app.mode, Mode::Normal);
    assert!(!app.busy);
}

fn with_library(uuids: &[&str]) -> App {
    let mut app = App::new(None);
    app.show_library(uuids.iter().map(|s| (*s).to_owned()).collect());
    app
}

#[test]
fn on_key_moves_the_selection_down_and_up_within_the_library() {
    let mut app = with_library(&["book-1", "book-2", "book-3"]);
    assert_eq!(app.selected_book(), Some("book-1"));

    app.on_key(code(KeyCode::Down), URL);
    assert_eq!(app.selected_book(), Some("book-2"));

    app.on_key(code(KeyCode::Down), URL);
    assert_eq!(app.selected_book(), Some("book-3"));

    app.on_key(code(KeyCode::Up), URL);
    assert_eq!(app.selected_book(), Some("book-2"));
}

#[test]
fn show_library_clamps_the_selection_when_the_library_shrinks() {
    let mut app = with_library(&["book-1", "book-2", "book-3"]);
    app.on_key(code(KeyCode::Down), URL);
    app.on_key(code(KeyCode::Down), URL);
    assert_eq!(app.selected_book(), Some("book-3"));

    app.show_library(vec!["book-9".to_owned()]);

    assert_eq!(app.selected_book(), Some("book-9"));
}

#[test]
fn on_key_returns_download_job_for_the_selected_book_when_d_pressed() {
    let mut app = with_library(&["book-1"]);

    let action = app.on_key(key('d'), URL);

    assert_eq!(action, Some(Action::Run(Job::Download("book-1".into()))));
}

#[test]
fn on_key_returns_finish_job_for_the_selected_book_when_f_pressed() {
    let mut app = with_library(&["book-1"]);

    let action = app.on_key(key('f'), URL);

    assert_eq!(action, Some(Action::Run(Job::Finish("book-1".into()))));
}

#[test]
fn on_key_returns_remove_download_job_for_the_selected_book_when_x_pressed() {
    let mut app = with_library(&["book-1"]);

    let action = app.on_key(key('x'), URL);

    assert_eq!(
        action,
        Some(Action::Run(Job::RemoveDownload("book-1".into())))
    );
}

#[test]
fn on_key_shows_no_book_error_when_d_pressed_on_an_empty_library() {
    let mut app = App::new(None);

    let action = app.on_key(key('d'), URL);

    assert_eq!(action, None);
    assert_eq!(app.status, Some(Status::Error(NO_BOOK.to_owned())));
}

#[test]
fn on_key_opens_the_percent_edit_for_the_selected_book_when_p_pressed() {
    let mut app = with_library(&["book-1"]);

    let action = app.on_key(key('p'), URL);

    assert_eq!(action, None);
    assert_eq!(
        app.mode,
        Mode::Editing(Edit {
            field: Field::Percent("book-1".into()),
            buffer: String::new(),
        })
    );
}

#[test]
fn on_key_returns_read_job_with_the_typed_percent_on_enter() {
    let mut app = with_library(&["book-1"]);
    app.on_key(key('p'), URL);
    type_text(&mut app, "42");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(
        action,
        Some(Action::Run(Job::Read {
            book: "book-1".into(),
            percent: Percent::new(42).unwrap(),
            location: None,
        }))
    );
    assert_eq!(app.mode, Mode::Normal);
}

#[test]
fn on_key_keeps_the_percent_edit_open_and_shows_an_error_for_101() {
    let mut app = with_library(&["book-1"]);
    app.on_key(key('p'), URL);
    type_text(&mut app, "101");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert!(matches!(app.mode, Mode::Editing(_)));
    assert!(matches!(app.status, Some(Status::Error(_))));
}

#[test]
fn on_key_opens_the_selected_book_on_enter() {
    let mut app = with_library(&["book-1"]);

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, Some(Action::Open("book-1".to_owned())));
}

#[test]
fn on_key_shows_no_book_for_enter_with_an_empty_library() {
    let mut app = App::new(None);

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert_eq!(app.status, Some(Status::Error(NO_BOOK.to_owned())));
}

fn reader_kepub() -> crate::kepub::Kepub {
    crate::kepub::Kepub::parse(crate::test_support::READER_KEPUB).unwrap()
}

#[test]
fn open_book_shows_metadata_only_for_a_book_that_is_not_downloaded() {
    let mut app = App::new(None);

    app.open_book("book-1".into(), Ok(None));

    match &app.mode {
        Mode::Reading(reader) => assert_eq!(reader.text, None),
        other => panic!("expected Reading, got {other:?}"),
    }
}

#[test]
fn open_book_reports_an_unreadable_book_and_stays_in_the_library() {
    let mut app = App::new(None);

    app.open_book("book-1".into(), Err("not a kepub".into()));

    assert_eq!(app.mode, Mode::Normal);
    assert_eq!(app.status, Some(Status::Error("not a kepub".to_owned())));
}

#[test]
fn on_key_returns_the_read_job_when_the_reader_closes() {
    let mut app = App::new(None);
    app.open_book("book-1".into(), Ok(Some(reader_kepub())));
    app.fit_reader(24, 3);

    let action = app.on_key(code(KeyCode::Esc), URL);

    match action {
        Some(Action::Run(Job::Read {
            book,
            percent,
            location,
        })) => {
            assert_eq!(book, "book-1");
            assert_eq!(u8::from(percent), 0);
            assert!(location.is_some());
        }
        other => panic!("expected a Read job, got {other:?}"),
    }
    assert_eq!(app.mode, Mode::Normal);
}

#[test]
fn on_key_keeps_the_reader_open_when_closing_while_busy() {
    let mut app = App::new(None);
    app.open_book("book-1".into(), Ok(Some(reader_kepub())));
    app.fit_reader(24, 3);
    app.busy = true;

    let action = app.on_key(code(KeyCode::Esc), URL);

    assert_eq!(action, None);
    assert!(matches!(app.mode, Mode::Reading(_)));
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
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

#[test]
fn show_book_opens_the_reader_on_the_page_holding_the_bookmarked_span() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    // ch2's `kobo.3.1` (span 2) starts at word 13; at 24x3 that word falls
    // on page 1 (page 0 covers words 0-10, page 1 words 11-20).
    assert_eq!(reader_position(&app), (1, 1));
}

#[test]
fn show_book_moves_the_page_when_a_newer_bookmark_arrives_while_reading() {
    let mut app = opened_reader_app();
    let first = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 1,
    };
    app.show_book(&library_with(book_with_bookmark(Some(first))));
    assert_eq!(reader_position(&app), (1, 1));

    let newer = crate::reading::Bookmark {
        percent: Percent::new(0),
        location: Some(KoboSpan {
            source: "ch1.xhtml".into(),
            value: "kobo.1.1".into(),
        }),
        modified: 2,
    };
    app.show_book(&library_with(book_with_bookmark(Some(newer))));

    assert_eq!(reader_position(&app), (0, 0));
}

#[test]
fn show_book_keeps_the_page_for_a_bookmark_no_newer_than_the_last_placed() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(80),
        location: Some(KoboSpan {
            source: "ch2.xhtml".into(),
            value: "kobo.3.1".into(),
        }),
        modified: 5,
    };
    app.show_book(&library_with(book_with_bookmark(Some(bookmark.clone()))));
    assert_eq!(reader_position(&app), (1, 1));
    app.on_key(code(KeyCode::Right), URL); // the reader's own page turn

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    assert_eq!(
        reader_position(&app),
        (1, 2),
        "a bookmark no newer than the last placed one must not undo a page turn"
    );
}

#[test]
fn on_key_refuses_a_readers_highlight_while_another_job_runs() {
    let mut app = opened_reader_app();
    if let Mode::Reading(reader) = &mut app.mode {
        reader.chapter = 1;
        reader.cursor = 2;
        reader.fit(24, 3);
        reader.selection = Some(crate::tui::reader::Selection {
            start: 2,
            end: 4,
            note: None,
        });
    }
    app.busy = true;

    let action = app.on_key(code(KeyCode::Char('3')), URL);

    assert_eq!(action, None);
    assert!(
        matches!(app.mode, Mode::Reading(_)),
        "the reader stays open"
    );
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn show_book_clears_a_stale_selection_when_it_moves_to_another_chapter() {
    let mut app = opened_reader_app();
    if let Mode::Reading(reader) = &mut app.mode {
        reader.cursor = 45; // a late word in ch1 (50 words, 0-49)
    }
    app.on_key(code(KeyCode::Char('v')), URL);
    match &app.mode {
        Mode::Reading(reader) => assert!(reader.selection.is_some(), "selection started"),
        other => panic!("expected Reading, got {other:?}"),
    }
    // ch3 (index 2) has only 8 words (0-7) — far shorter than word 45.
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(90),
        location: Some(KoboSpan {
            source: "ch3.xhtml".into(),
            value: "kobo.2.1".into(),
        }),
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    assert_eq!(reader_position(&app).0, 2, "moved to ch3");
    match &app.mode {
        Mode::Reading(reader) => assert_eq!(
            reader.selection, None,
            "the selection must not survive the jump"
        ),
        other => panic!("expected Reading, got {other:?}"),
    }

    let right = app.on_key(code(KeyCode::Right), URL);
    let digit = app.on_key(code(KeyCode::Char('1')), URL);

    assert_eq!(right, None, "no stray action from extending a cleared selection");
    assert_eq!(digit, None, "no Highlight job without an open selection");
}

#[test]
fn on_key_refuses_to_close_the_reader_while_the_device_is_syncing() {
    let mut app = opened_reader_app();
    app.device_syncing = true;

    let action = app.on_key(code(KeyCode::Esc), URL);

    assert_eq!(action, None);
    assert!(
        matches!(app.mode, Mode::Reading(_)),
        "the reader stays open"
    );
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn on_key_refuses_to_commit_a_highlight_while_the_device_is_syncing() {
    let mut app = opened_reader_app();
    if let Mode::Reading(reader) = &mut app.mode {
        reader.chapter = 1;
        reader.cursor = 2;
        reader.fit(24, 3);
        reader.selection = Some(crate::tui::reader::Selection {
            start: 2,
            end: 4,
            note: None,
        });
    }
    app.device_syncing = true;

    let action = app.on_key(code(KeyCode::Char('1')), URL);

    assert_eq!(action, None);
    match &app.mode {
        Mode::Reading(reader) => assert!(reader.selection.is_some(), "the selection survives"),
        other => panic!("expected Reading, got {other:?}"),
    }
    assert_eq!(app.status, Some(Status::Error(BUSY.to_owned())));
}

#[test]
fn ctrl_c_in_the_reader_sends_the_read_job_before_quitting() {
    let mut app = opened_reader_app();

    let action = app.on_key(ctrl_c(), URL);

    match action {
        Some(Action::Run(Job::Read { book, .. })) => assert_eq!(book, "book-1"),
        other => panic!("expected a Read job, got {other:?}"),
    }
    assert_eq!(app.mode, Mode::Normal);
    assert!(app.busy, "quit waits for the job, same as a busy job today");
}

#[test]
fn show_book_reports_a_bookmarked_span_the_book_does_not_hold() {
    let mut app = opened_reader_app();
    let bookmark = crate::reading::Bookmark {
        percent: Percent::new(10),
        location: Some(KoboSpan {
            source: "ch9.xhtml".into(),
            value: "kobo.9.9".into(),
        }),
        modified: 1,
    };

    app.show_book(&library_with(book_with_bookmark(Some(bookmark))));

    assert_eq!(reader_position(&app), (0, 0), "the reader stays put");
    assert!(matches!(app.status, Some(Status::Error(_))));
}
