//! The library screen: selecting a book, and the download/finish/remove/
//! percent/open actions on the selected one.

use super::*;

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
