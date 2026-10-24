//! `Mode::Editing`: opening the URL/token/percent fields, typing into the
//! buffer, and saving or cancelling.

use super::*;

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
