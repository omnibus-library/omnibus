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
        Mode::Normal => None,
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
    assert_eq!(app.on_key(code(KeyCode::Enter), URL), None);
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
fn on_key_opens_the_highlight_edit_for_the_selected_book_when_h_pressed() {
    let mut app = with_library(&["book-1"]);

    let action = app.on_key(key('h'), URL);

    assert_eq!(action, None);
    assert_eq!(
        app.mode,
        Mode::Editing(Edit {
            field: Field::Highlight("book-1".into()),
            buffer: String::new(),
        })
    );
}

#[test]
fn on_key_shows_no_book_error_when_h_pressed_on_an_empty_library() {
    let mut app = App::new(None);

    let action = app.on_key(key('h'), URL);

    assert_eq!(action, None);
    assert_eq!(app.status, Some(Status::Error(NO_BOOK.to_owned())));
}

#[test]
fn on_key_returns_highlight_job_with_the_swatch_text_and_note_on_enter() {
    let mut app = with_library(&["book-1"]);
    app.on_key(key('h'), URL);
    type_text(&mut app, "kobo.1.1 0-12 2 a passage // a thought");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(
        action,
        Some(Action::Run(Job::Highlight {
            book: "book-1".into(),
            highlight: NewHighlight {
                text: "a passage".into(),
                color: Swatch::Pink,
                note: Some("a thought".into()),
                location: Some(SpanRange {
                    chapter: "unknown".into(),
                    start_span: "kobo.1.1".into(),
                    start_char: 0,
                    end_span: "kobo.1.1".into(),
                    end_char: 12,
                }),
            },
        }))
    );
    assert_eq!(app.mode, Mode::Normal);
}

#[test]
fn on_key_returns_a_yellow_highlight_job_when_no_swatch_digit_leads() {
    let mut app = with_library(&["book-1"]);
    app.on_key(key('h'), URL);
    type_text(&mut app, "kobo.1.1 0-12 a passage");

    let action = app.on_key(code(KeyCode::Enter), URL);

    match action {
        Some(Action::Run(Job::Highlight { highlight, .. })) => {
            assert_eq!(highlight.color, Swatch::Yellow);
            assert_eq!(highlight.text, "a passage");
            assert_eq!(highlight.note, None);
        }
        other => panic!("expected a Highlight job, got {other:?}"),
    }
}

#[test]
fn on_key_keeps_the_highlight_edit_open_and_shows_an_error_for_empty_text() {
    let mut app = with_library(&["book-1"]);
    app.on_key(key('h'), URL);
    type_text(&mut app, "kobo.1.1 0-12");

    let action = app.on_key(code(KeyCode::Enter), URL);

    assert_eq!(action, None);
    assert!(matches!(app.mode, Mode::Editing(_)));
    assert!(matches!(app.status, Some(Status::Error(_))));
}

#[test]
fn on_key_returns_delete_highlight_job_for_the_selected_book_when_e_pressed() {
    let mut app = with_library(&["book-1"]);

    let action = app.on_key(key('e'), URL);

    assert_eq!(
        action,
        Some(Action::Run(Job::DeleteHighlight("book-1".into())))
    );
}
